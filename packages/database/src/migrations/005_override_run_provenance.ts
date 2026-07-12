import { sql } from "kysely";
import type { Migration } from "kysely/migration";

/** Normalized reviewed override identity can be associated with every publishing run. */
export const overrideRunProvenanceMigration: Migration = {
  async up(db) {
    await sql.raw(`
      create table override_application_runs (
        override_application_id uuid not null references override_applications(id),
        sync_run_id uuid not null references sync_runs(id),
        primary key (override_application_id, sync_run_id)
      );
      alter table sync_runs add column reused_dataset_version_id uuid references dataset_versions(id);
      create trigger override_application_runs_append_only_before_mutation
        before update or delete on override_application_runs
        for each row execute function riftversus_reject_append_only_mutation();
      insert into override_application_runs (override_application_id, sync_run_id)
      select id, sync_run_id from override_applications where sync_run_id is not null;
      alter table override_applications drop column sync_run_id;
      comment on table override_application_runs is
        'Canonical append-only association between a normalized reviewed override file/checksum and every publishing sync run.';
      comment on column sync_runs.reused_dataset_version_id is
        'For an unchanged successful run, identifies the previously published dataset version whose provenance was reused.';
    `).execute(db);
  },
  async down(db) {
    await sql.raw(`
      do $$
      begin
        if exists (
          select 1 from override_application_runs
          group by override_application_id having count(*) > 1
        ) then
          raise exception 'Cannot losslessly downgrade override run provenance: at least one reviewed override application is associated with multiple sync runs.';
        end if;
      end;
      $$;
      alter table override_applications add column sync_run_id uuid references sync_runs(id);
      alter table override_applications disable trigger override_applications_append_only_before_mutation;
      update override_applications application set sync_run_id = (
        select association.sync_run_id from override_application_runs association
        where association.override_application_id = application.id
      );
      alter table override_applications enable trigger override_applications_append_only_before_mutation;
      alter table sync_runs drop column if exists reused_dataset_version_id;
      drop table if exists override_application_runs;
    `).execute(db);
  },
};
