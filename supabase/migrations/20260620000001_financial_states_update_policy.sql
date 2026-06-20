-- Allow students to update their own financial states.
-- Needed so the simulation engine can apply decision impacts
-- to the current week's financial state row.

create policy "Students can update own financial states"
  on public.financial_states for update
  using (public.student_owns_character(character_id))
  with check (public.student_owns_character(character_id));
