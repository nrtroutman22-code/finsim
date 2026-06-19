-- Update life paths and locations to match character creation wizard.
-- Safe to run in early dev — will fail harmlessly if characters already
-- reference the old IDs (FK constraint prevents data loss).

delete from public.locations;
delete from public.life_paths;

insert into public.life_paths (id, name, description, starting_monthly_income, starting_cash, starting_savings, starting_debt, starting_credit_score, sort_order) values
  ('retail-food',   'Retail / Food Service',  'Start working right away in retail, restaurants, or customer service.',          2000, 500, 500,     0, 650, 1),
  ('trades',        'Trades Apprentice',      'Begin an apprenticeship learning a skilled trade like plumbing or electrical.',  2650, 600, 600,     0, 650, 2),
  ('office-admin',  'Office / Admin',         'Start in an office or administrative support role.',                            2400, 500, 500,     0, 650, 3),
  ('military',      'Military Enlistment',    'Enlist in the armed forces with steady pay and benefits.',                      2300, 800, 800,     0, 650, 4),
  ('gig-freelance', 'Gig / Freelance',        'Work flexible gig economy or freelance jobs.',                                 2100, 400, 400,     0, 650, 5),
  ('healthcare',    'Healthcare Support',     'Work in healthcare support roles like CNA or medical assistant.',               2500, 500, 500,     0, 650, 6),
  ('cc-parttime',   'CC + Part-Time Work',    'Attend community college while working part-time.',                            1200, 300, 300,  4500, 650, 7),
  ('cc-fulltime',   'CC + Full-Time Work',    'Attend community college while working full-time.',                            2000, 400, 400,  4500, 650, 8),
  ('uni-oncampus',  'University On Campus',   'Attend a 4-year university living on campus.',                                 1000, 200, 200, 11000, 650, 9),
  ('uni-offcampus', 'University Off Campus',  'Attend a 4-year university living off campus.',                                1000, 300, 300, 11000, 650, 10);

insert into public.locations (id, name, description, cost_of_living_modifier, sort_order) values
  ('big-city',       'Big City',       'A major metro area. Lots of opportunities but high rent.',             1.40, 1),
  ('mid-size-city',  'Mid-Size City',  'A mid-size city with moderate costs and decent job options.',          1.10, 2),
  ('small-town',     'Small Town',     'A smaller community where your money stretches further.',             0.85, 3),
  ('living-at-home', 'Living at Home', 'Stay with family and contribute to household expenses.',              0.70, 4);
