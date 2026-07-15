ALTER TABLE reviews ADD COLUMN interest INTEGER CHECK(interest BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN practicality INTEGER CHECK(practicality BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN workload_score INTEGER CHECK(workload_score BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN fairness INTEGER CHECK(fairness BETWEEN 1 AND 5);
ALTER TABLE reviews ADD COLUMN organization INTEGER CHECK(organization BETWEEN 1 AND 5);
