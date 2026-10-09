-- "Musik & Equipment" was too specific for a general app; it becomes "Hobbys" with all bookings, rules and budget.
DO $$
DECLARE
  old_id uuid;
  new_id uuid;
BEGIN
  SELECT id INTO old_id FROM categories WHERE name = 'Musik & Equipment';
  IF old_id IS NULL THEN
    RETURN;
  END IF;
  SELECT id INTO new_id FROM categories WHERE name = 'Hobbys';
  IF new_id IS NULL THEN
    UPDATE categories SET name = 'Hobbys' WHERE id = old_id;
    RETURN;
  END IF;
  -- Both exist (someone created "Hobbys" by hand): merge into it, nothing is lost.
  UPDATE transactions SET category_id = new_id WHERE category_id = old_id;
  UPDATE rules SET category_id = new_id WHERE category_id = old_id;
  IF EXISTS (SELECT 1 FROM budgets WHERE category_id = new_id) THEN
    DELETE FROM budgets WHERE category_id = old_id;
  ELSE
    UPDATE budgets SET category_id = new_id WHERE category_id = old_id;
  END IF;
  DELETE FROM categories WHERE id = old_id;
END $$;
