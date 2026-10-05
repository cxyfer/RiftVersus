import { sql } from "kysely";
import type { Migration } from "kysely/migration";

export const historicalSeriesFormatsMigration: Migration = {
  async up(db) {
    await sql`
      alter table tournaments drop constraint tournaments_category_check;
      alter table tournaments add constraint tournaments_category_check
        check (category in ('league', 'fst', 'msi', 'worlds', 'ewc', 'other'));
      alter table series_facts drop constraint series_facts_best_of_check;
      alter table series_facts add constraint series_facts_best_of_check check (best_of in (1, 2, 3, 5));
      alter table series_facts drop constraint series_facts_check;
      alter table series_facts drop constraint series_facts_check1;
      alter table series_facts add constraint series_facts_side_a_score_check
        check (side_a_score is null or side_a_score between 0 and best_of / 2 + 1);
      alter table series_facts add constraint series_facts_side_b_score_check
        check (side_b_score is null or side_b_score between 0 and best_of / 2 + 1);
      alter table series_facts drop constraint series_facts_completed_result;
      alter table series_facts add constraint series_facts_completed_result check (
        (not completed and winner_team_id is null) or
        (completed and side_a_score is not null and side_b_score is not null and (
          (best_of = 2 and side_a_score = 1 and side_b_score = 1 and winner_team_id is null) or
          (winner_team_id is not null and (best_of <> 2 or side_a_score + side_b_score = 2))
        ))
      );
      alter table series_facts drop constraint series_facts_winner_matches_score;
      alter table series_facts add constraint series_facts_winner_matches_score check (
        winner_team_id is null or
        (winner_team_id = side_a_team_id and side_a_score = best_of / 2 + 1 and side_b_score < best_of / 2 + 1) or
        (winner_team_id = side_b_team_id and side_b_score = best_of / 2 + 1 and side_a_score < best_of / 2 + 1)
      );
    `.execute(db);
  },
  async down(db) {
    await sql`
      lock table series_facts, tournaments in access exclusive mode;
      do $$ begin
        if exists (select 1 from series_facts where best_of = 2)
          or exists (select 1 from tournaments where category = 'ewc') then
          raise exception 'Cannot losslessly downgrade historical series formats';
        end if;
      end $$;
      alter table series_facts drop constraint series_facts_best_of_check;
      alter table series_facts add constraint series_facts_best_of_check check (best_of in (1, 3, 5));
      alter table series_facts drop constraint series_facts_side_a_score_check;
      alter table series_facts drop constraint series_facts_side_b_score_check;
      alter table series_facts add constraint series_facts_check
        check (side_a_score is null or side_a_score between 0 and (best_of + 1) / 2);
      alter table series_facts add constraint series_facts_check1
        check (side_b_score is null or side_b_score between 0 and (best_of + 1) / 2);
      alter table series_facts drop constraint series_facts_completed_result;
      alter table series_facts add constraint series_facts_completed_result check (
        (not completed and winner_team_id is null) or
        (completed and winner_team_id is not null and side_a_score is not null and side_b_score is not null)
      );
      alter table series_facts drop constraint series_facts_winner_matches_score;
      alter table series_facts add constraint series_facts_winner_matches_score check (
        winner_team_id is null or
        (winner_team_id = side_a_team_id and side_a_score = (best_of + 1) / 2 and side_b_score < (best_of + 1) / 2) or
        (winner_team_id = side_b_team_id and side_b_score = (best_of + 1) / 2 and side_a_score < (best_of + 1) / 2)
      );
      alter table tournaments drop constraint tournaments_category_check;
      alter table tournaments add constraint tournaments_category_check
        check (category in ('league', 'fst', 'msi', 'worlds', 'other'));
    `.execute(db);
  },
};
