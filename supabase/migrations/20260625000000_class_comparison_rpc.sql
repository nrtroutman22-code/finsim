-- RPC function for anonymous class comparison data.
-- Uses security definer to bypass RLS and return aggregated peer stats
-- without exposing individual student identities.

create or replace function public.get_class_comparison(p_section_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  result json;
begin
  -- Verify the caller is an approved student in this section
  if not exists (
    select 1 from enrollments
    where section_id = p_section_id
      and student_id = auth.uid()
      and status = 'approved'
  ) then
    raise exception 'Not authorized';
  end if;

  select json_agg(row_to_json(t))
  into result
  from (
    select
      c.id as character_id,
      c.life_path_id,
      fs.net_worth,
      fs.cash,
      fs.savings,
      fs.debt,
      fs.credit_score,
      fs.monthly_income,
      fs.monthly_expenses
    from enrollments e
    join characters c on c.enrollment_id = e.id
    join lateral (
      select *
      from financial_states
      where character_id = c.id
      order by week desc
      limit 1
    ) fs on true
    where e.section_id = p_section_id
      and e.status = 'approved'
  ) t;

  return coalesce(result, '[]'::json);
end;
$$;
