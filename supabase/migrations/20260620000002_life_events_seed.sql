-- Replace life events seed data with updated events and options.
-- Safe to re-run: deletes children first (cascades handle options).

delete from public.section_life_events;
delete from public.life_event_options;
delete from public.life_events;

-- Allow students to insert section_life_events for their own section
-- (needed for the random life event trigger in the simulation engine).
create policy "Students can trigger life events for own section"
  on public.section_life_events for insert
  with check (
    exists (
      select 1 from public.enrollments
      where enrollments.section_id = section_life_events.section_id
        and enrollments.student_id = (select auth.uid())
        and enrollments.status = 'approved'
    )
  );

do $$
declare
  ev_car_breakdown      uuid;
  ev_medical_bill       uuid;
  ev_roommate_bails     uuid;
  ev_hours_cut          uuid;
  ev_identity_theft     uuid;
  ev_job_promotion      uuid;
  ev_tax_refund         uuid;
  ev_work_bonus         uuid;
  ev_cheaper_apartment  uuid;
  ev_employer_401k      uuid;
  ev_pet_emergency      uuid;
begin

  -- ── NEGATIVE EVENTS ───────────────────────────────────

  -- 1. Car Trouble
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Car Trouble',
    'Your car won''t start this morning. The mechanic says it needs a new alternator — $380 to fix it. You need your car to get to work. What do you do?',
    'budgeting', false
  ) returning id into ev_car_breakdown;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_car_breakdown, 'Pay out of pocket',             'Use your cash to fix it right away.',                    '{"cash": -380}', 1),
    (ev_car_breakdown, 'Put it on a credit card',       'No cash hit now, but you''ll owe more with interest.',   '{"debt": 380, "credit_score": -5}', 2),
    (ev_car_breakdown, 'Ask family for help',           'They can cover most of it — you just chip in $100.',     '{"cash": -100}', 3),
    (ev_car_breakdown, 'Take public transit this week', 'Skip the repair for now and bus to work.',               '{"cash": -50, "monthly_expenses": 50}', 4);

  -- 2. Unexpected Medical Bill
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Unexpected Medical Bill',
    'You had to visit urgent care and just received a $450 bill. You were not expecting this expense.',
    'budgeting', false
  ) returning id into ev_medical_bill;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_medical_bill, 'Pay it immediately',       'Use your cash to clear the bill.',                         '{"cash": -450}', 1),
    (ev_medical_bill, 'Set up a payment plan',    'Spread it over several months.',                           '{"debt": 450, "monthly_expenses": 50}', 2),
    (ev_medical_bill, 'Put it on a credit card',  'No cash hit now, but interest will pile up.',               '{"debt": 450, "credit_score": -8}', 3),
    (ev_medical_bill, 'Ignore it for now',        'Hope it goes away. It won''t.',                            '{"debt": 450, "credit_score": -20}', 4);

  -- 3. Roommate Moves Out
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Roommate Moves Out',
    'Your roommate just told you they are moving out next month. Your rent is going up by $300/mo. What do you do?',
    'budgeting', false
  ) returning id into ev_roommate_bails;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_roommate_bails, 'Find a new roommate',            'Post online and find someone — costs a little to advertise.', '{"cash": -100}', 1),
    (ev_roommate_bails, 'Move to a cheaper place',        'Pay moving costs now but save on rent long-term.',            '{"cash": -500, "monthly_expenses": -150}', 2),
    (ev_roommate_bails, 'Pay the extra rent alone',       'You can handle it, but it''s a big monthly hit.',             '{"monthly_expenses": 300}', 3),
    (ev_roommate_bails, 'Move back home temporarily',     'Save on rent but pay moving costs.',                          '{"monthly_expenses": -200, "cash": -200}', 4);

  -- 4. Hours Cut at Work
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Hours Cut at Work',
    'Your employer just cut your hours by 20%. Your monthly income will be lower this month.',
    'budgeting', false
  ) returning id into ev_hours_cut;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_hours_cut, 'Pick up a side gig',                  'Drive rideshare or deliver food to make up the difference.', '{"monthly_income": 200}', 1),
    (ev_hours_cut, 'Cut your expenses immediately',       'Cancel subscriptions and cut eating out.',                   '{"monthly_expenses": -150}', 2),
    (ev_hours_cut, 'Dip into savings',                    'Use savings to cover the gap for now.',                      '{"savings": -300}', 3),
    (ev_hours_cut, 'Use a credit card to cover the gap',  'No cash hit, but you''ll owe more.',                         '{"debt": 300, "credit_score": -5}', 4);

  -- 5. Identity Theft Alert
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Identity Theft Alert',
    'You received an alert that someone may have stolen your identity and opened a credit card in your name with a $800 balance.',
    'debt', false
  ) returning id into ev_identity_theft;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_identity_theft, 'Report it immediately and dispute the charge', 'File a report. Takes time but protects your credit.',  '{"credit_score": 5}', 1),
    (ev_identity_theft, 'Freeze your credit',                          'Lock everything down to prevent further damage.',       '{"credit_score": 10}', 2),
    (ev_identity_theft, 'Ignore it and hope it goes away',             'Bad idea. The debt and damage will pile up.',           '{"debt": 800, "credit_score": -40}', 3),
    (ev_identity_theft, 'Pay the fraudulent charge',                   'Just pay it off to make it go away.',                  '{"cash": -800}', 4);

  -- 6. Pet Emergency
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Pet Emergency',
    'Your pet needs emergency vet care. The bill is $600. What do you do?',
    'budgeting', false
  ) returning id into ev_pet_emergency;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_pet_emergency, 'Pay out of pocket',                    'Use your cash to cover it.',                            '{"cash": -600}', 1),
    (ev_pet_emergency, 'Put it on a credit card',              'No cash hit now, but interest will pile up.',            '{"debt": 600, "credit_score": -8}', 2),
    (ev_pet_emergency, 'Set up a payment plan with the vet',   'Spread it over several months.',                        '{"debt": 600, "monthly_expenses": 60}', 3),
    (ev_pet_emergency, 'Ask family for help',                  'They can cover most of it.',                            '{"cash": -200}', 4);

  -- ── POSITIVE EVENTS ───────────────────────────────────

  -- 7. Job Promotion
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Job Promotion!',
    'Great news — you just got promoted! Your monthly income is increasing by $200/mo starting next month.',
    'budgeting', true
  ) returning id into ev_job_promotion;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_job_promotion, 'Save the extra income',              'Build your savings faster.',                              '{"savings": 200, "credit_score": 3}', 1),
    (ev_job_promotion, 'Pay down debt with it',              'Knock out what you owe.',                                 '{"debt": -200, "credit_score": 5}', 2),
    (ev_job_promotion, 'Upgrade your lifestyle',             'Better apartment, better food, better everything.',       '{"monthly_expenses": 200}', 3),
    (ev_job_promotion, 'Split it between savings and fun',   'A little of both.',                                      '{"savings": 100, "cash": 100}', 4);

  -- 8. Tax Refund
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Tax Refund!',
    'You just received a $650 tax refund. What do you do with it?',
    'budgeting', true
  ) returning id into ev_tax_refund;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_tax_refund, 'Put it all in savings',    'Grow your emergency fund.',                                '{"savings": 650, "credit_score": 3}', 1),
    (ev_tax_refund, 'Pay off debt',             'Knock out some of what you owe.',                          '{"debt": -650, "credit_score": 8}', 2),
    (ev_tax_refund, 'Invest it',                'Put it toward long-term growth.',                          '{"savings": 650, "credit_score": 5}', 3),
    (ev_tax_refund, 'Spend it on something you want', 'Treat yourself. You earned it.',                     '{"cash": -650}', 4);

  -- 9. Work Bonus
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Work Bonus!',
    'Your employer gave you a $500 performance bonus this month. Nice work!',
    'budgeting', true
  ) returning id into ev_work_bonus;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_work_bonus, 'Save the entire bonus',    'Straight to savings.',                                     '{"savings": 500, "credit_score": 3}', 1),
    (ev_work_bonus, 'Pay down debt',            'Use it to reduce what you owe.',                           '{"debt": -500, "credit_score": 6}', 2),
    (ev_work_bonus, 'Treat yourself',           'Spend a little, save a little.',                           '{"cash": -200, "savings": 300}', 3),
    (ev_work_bonus, 'Spend it all',             'YOLO.',                                                   '{"cash": -500}', 4);

  -- 10. Better Apartment Deal
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Better Apartment Deal',
    'You found a cheaper apartment that saves you $150/mo in rent. Moving costs $400 upfront.',
    'budgeting', true
  ) returning id into ev_cheaper_apartment;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_cheaper_apartment, 'Move to the cheaper place',       'Pay moving costs now, save every month.',                '{"cash": -400, "monthly_expenses": -150}', 1),
    (ev_cheaper_apartment, 'Stay where you are',              'No risk, no change.',                                   '{}', 2),
    (ev_cheaper_apartment, 'Negotiate with current landlord', 'Ask for a rent reduction. They might meet you halfway.', '{"monthly_expenses": -75}', 3);

  -- 11. Employer 401k Match
  insert into public.life_events (title, description, category, is_positive)
  values (
    'Employer 401k Match',
    'Your employer just announced they will match 50% of your 401k contributions up to 3% of your salary. Do you enroll?',
    'investing', true
  ) returning id into ev_employer_401k;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_employer_401k, 'Enroll at 3% contribution',            'Get the full employer match.',                          '{"savings": 150, "monthly_expenses": 75, "credit_score": 5}', 1),
    (ev_employer_401k, 'Enroll at 1% contribution',            'Small contribution, small match.',                      '{"savings": 50, "monthly_expenses": 25}', 2),
    (ev_employer_401k, 'Skip it for now',                      'Keep your full paycheck. You''ll invest later.',        '{}', 3),
    (ev_employer_401k, 'Enroll at 6% to maximize savings',     'Go big on retirement. Bigger paycheck hit though.',     '{"savings": 300, "monthly_expenses": 150, "credit_score": 8}', 4);

end;
$$;
