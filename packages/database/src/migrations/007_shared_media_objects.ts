import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const sharedMediaObjectsMigration: Migration = {
  async up(db) {
    await sql.raw(`
      create table media_objects (
        object_key text primary key,
        checksum text not null,
        content_type text not null,
        byte_size bigint not null check (byte_size >= 0)
      );
      insert into media_objects (object_key, checksum, content_type, byte_size)
      select object_key, coalesce(checksum, 'legacy-unverified:' || md5(object_key)), coalesce(content_type, 'application/octet-stream'), coalesce(byte_size, 0)
      from media_assets;
      alter table media_assets drop constraint media_assets_object_key_key;
      alter table media_assets add constraint media_assets_object_key_fk foreign key (object_key) references media_objects(object_key);
      alter table media_assets drop column checksum;
      alter table media_assets drop column content_type;
      alter table media_assets drop column byte_size;
      create index media_assets_object_owners on media_assets (object_key);
      create trigger media_objects_append_only_before_mutation
        before update or delete on media_objects
        for each row execute function riftversus_reject_append_only_mutation();
    `).execute(db);
  },
  async down(db) {
    await sql.raw(`
      do $$ begin
        if exists (select 1 from media_assets group by object_key having count(*) > 1) then
          raise exception 'Cannot losslessly downgrade shared media objects: at least one immutable object has multiple owners.';
        end if;
      end $$;
      drop index if exists media_assets_object_owners;
      alter table media_assets add column checksum text;
      alter table media_assets add column content_type text;
      alter table media_assets add column byte_size bigint check (byte_size is null or byte_size >= 0);
      update media_assets owner set checksum = object.checksum, content_type = object.content_type, byte_size = object.byte_size
      from media_objects object where object.object_key = owner.object_key;
      alter table media_assets drop constraint media_assets_object_key_fk;
      alter table media_assets add constraint media_assets_object_key_key unique (object_key);
      drop trigger if exists media_objects_append_only_before_mutation on media_objects;
      drop table media_objects;
    `).execute(db);
  },
};
