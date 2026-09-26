-- =====================================================================
-- District Collector Dashboard — MySQL Schema + Seed Data
-- Run: mysql -u root -p < schema.sql
-- =====================================================================

CREATE DATABASE IF NOT EXISTS district_collector_dashboard
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE district_collector_dashboard;

SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- 1. ZONES  (GCC's 15 zones)
-- =====================================================================
DROP TABLE IF EXISTS zones;
CREATE TABLE zones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  zone_number INT NOT NULL UNIQUE,
  zone_name VARCHAR(100) NOT NULL,
  ward_start INT NOT NULL,
  ward_end INT NOT NULL
) ENGINE=InnoDB;

INSERT INTO zones (zone_number, zone_name, ward_start, ward_end) VALUES
  (1,  'Thiruvottiyur',      1,   14),
  (2,  'Manali',             15,  21),
  (3,  'Madhavaram',         22,  33),
  (4,  'Tondiarpet',         34,  48),
  (5,  'Royapuram',          49,  63),
  (6,  'Thiru-Vi-Ka-Nagar',  64,  72),
  (7,  'Ambattur',           73,  81),
  (8,  'Anna Nagar',         82,  93),
  (9,  'Teynampet',          94,  108),
  (10, 'Kodambakkam',        109, 126),
  (11, 'Valasaravakkam',     127, 142),
  (12, 'Alandur',            143, 155),
  (13, 'Adyar',               156, 168),
  (14, 'Perungudi',          169, 182),
  (15, 'Sholinganallur',     183, 200);

-- =====================================================================
-- 2. LOCALITIES  (filtered by zone)
-- =====================================================================
DROP TABLE IF EXISTS localities;
CREATE TABLE localities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  zone_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  CONSTRAINT fk_localities_zone FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE,
  INDEX idx_localities_zone (zone_id)
) ENGINE=InnoDB;

INSERT INTO localities (zone_id, name) VALUES
  (1, 'Thiruvottiyur'), (1, 'Ennore'),
  (2, 'Manali'),
  (3, 'Madhavaram'), (3, 'Kodungaiyur'),
  (4, 'Tondiarpet'),
  (5, 'Royapuram'), (5, 'Vyasarpadi'),
  (6, 'Perambur'), (6, 'Purasaiwalkam'),
  (7, 'Ambattur'),
  (8, 'Anna Nagar'), (8, 'Kilpauk'),
  (9, 'Teynampet'), (9, 'Nungambakkam'), (9, 'Egmore'),
  (10, 'T. Nagar'), (10, 'Kodambakkam'), (10, 'Vadapalani'),
  (11, 'Valasaravakkam'), (11, 'Virugambakkam'),
  (12, 'Alandur'), (12, 'Guindy'), (12, 'Ashok Nagar'),
  (13, 'Adyar'), (13, 'Mylapore'), (13, 'Besant Nagar'), (13, 'Thiruvanmiyur'),
  (14, 'Perungudi'), (14, 'Velachery'),
  (15, 'Sholinganallur'), (15, 'Pallikaranai');

-- =====================================================================
-- 3. STREETS  (filtered by locality)
-- NOTE: These are generic placeholder street names, seeded uniformly per
-- locality for demo purposes. Replace with a real GIS street master
-- (e.g. GCC's official street/road database) when it becomes available.
-- =====================================================================
DROP TABLE IF EXISTS streets;
CREATE TABLE streets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  locality_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  CONSTRAINT fk_streets_locality FOREIGN KEY (locality_id) REFERENCES localities(id) ON DELETE CASCADE,
  INDEX idx_streets_locality (locality_id)
) ENGINE=InnoDB;

INSERT INTO streets (locality_id, name)
SELECT l.id, s.name
FROM localities l
JOIN (
  SELECT 'Main Road' AS name UNION ALL
  SELECT '1st Cross Street' UNION ALL
  SELECT '2nd Cross Street' UNION ALL
  SELECT 'Bazaar Street' UNION ALL
  SELECT 'Temple Street' UNION ALL
  SELECT 'Market Street'
) s;

-- =====================================================================
-- 4. DEPARTMENTS (exactly 16)
-- =====================================================================
DROP TABLE IF EXISTS departments;
CREATE TABLE departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  description VARCHAR(500) NOT NULL
) ENGINE=InnoDB;

INSERT INTO departments (id, name, description) VALUES
(1,  'Revenue Department', 'Property tax, profession tax, advertisement tax, parking fees, change of ownership.'),
(2,  'Engineering Department (Town Planning & Building Permissions)', 'Building plan sanction, building permits, private street maintenance, road/pothole repair.'),
(3,  'Electrical Department', 'Street lights, cable laying, electric crematoriums.'),
(4,  'Solid Waste Management Department', 'Garbage collection and removal, night conservancy.'),
(5,  'Storm Water Drain Department', 'Construction, maintenance, desilting of drains, water stagnation.'),
(6,  'Bridges Department', 'Construction/maintenance of bridges, causeways, subways.'),
(7,  'Health Department', 'Dispensaries, public health, sanitation, food adulteration, birth & death certificates, sanitary certificates, stray animals, mosquito control.'),
(8,  'Family Welfare Department', 'Maternity & child welfare centers, immunization.'),
(9,  'Education Department', 'Schools, nutritious meal centers.'),
(10, 'Parks & Play Fields Department', 'Parks, playgrounds, swimming pools, trees.'),
(11, 'Buildings Department', 'School buildings, public conveniences, community halls, hospital construction.'),
(12, 'Mechanical Engineering Department', 'Corporation vehicle/lorry maintenance.'),
(13, 'Land & Estate Department', 'Leasing corporation land/buildings/shops.'),
(14, 'General Administration', 'Staff/admin matters.'),
(15, 'Financial Management Unit', 'Budget, loans, grants.'),
(16, 'Council Department', 'Mayor/council secretariat matters.');

-- =====================================================================
-- 5. COMPLAINT TYPES
-- =====================================================================
DROP TABLE IF EXISTS complaint_types;
CREATE TABLE complaint_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  department_id INT NOT NULL,
  is_frequent BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_complaint_types_dept FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_complaint_types_dept (department_id)
) ENGINE=InnoDB;

INSERT INTO complaint_types (name, department_id, is_frequent) VALUES
('Street Light Not Functioning', 3, TRUE),
('Street Light Damaged / Post Pole Issue', 3, FALSE),
('Garbage Not Collected', 4, TRUE),
('Overflowing Garbage Bin', 4, FALSE),
('Sewage Overflow', 5, TRUE),
('Illegal Draining of Sewage into Storm Water Drain', 5, FALSE),
('Stagnation of Water', 5, TRUE),
('Pothole / Road Damage', 2, TRUE),
('Removal of Debris', 2, FALSE),
('Illegal Construction', 2, TRUE),
('Unauthorized Building / No Building Permit', 2, FALSE),
('Removal of Shops / Encroachment on Footpath', 1, FALSE),
('Property Tax Discrepancy', 1, FALSE),
('Stray Animal Menace', 7, FALSE),
('Food Adulteration Complaint', 7, FALSE),
('Birth/Death Certificate Issue', 7, FALSE),
('Mosquito Breeding / Fogging Request', 7, FALSE),
('Damaged Tree / Fallen Tree', 10, FALSE),
('Park Maintenance Issue', 10, FALSE),
('School Infrastructure Complaint', 9, FALSE),
('Bridge/Subway Damage', 6, FALSE),
('Others', 1, FALSE);

-- =====================================================================
-- 6. USERS
-- =====================================================================
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('collector','department_officer','citizen') NOT NULL,
  department_id INT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_department FOREIGN KEY (department_id) REFERENCES departments(id),
  INDEX idx_users_role (role)
) ENGINE=InnoDB;

-- =====================================================================
-- 7. USER PROFILES  (1:1 with users)
-- =====================================================================
DROP TABLE IF EXISTS user_profiles;
CREATE TABLE user_profiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  gender ENUM('Male','Female','Transgender') NULL,
  date_of_birth DATE NULL,
  mobile_number VARCHAR(10) NULL UNIQUE,
  mobile_verified BOOLEAN NOT NULL DEFAULT FALSE,
  alternate_email VARCHAR(255) NULL,
  door_no_and_street VARCHAR(255) NULL,
  area VARCHAR(150) NULL,
  locality VARCHAR(150) NULL,
  pincode VARCHAR(6) NULL,
  zone_id INT NULL,
  ward_number INT NULL,
  aadhaar_number_encrypted VARCHAR(255) NULL,
  aadhaar_last4 CHAR(4) NULL,
  profile_photo VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_profiles_zone FOREIGN KEY (zone_id) REFERENCES zones(id)
) ENGINE=InnoDB;

-- =====================================================================
-- 8. PASSWORD RESETS / OTP  (reused for forgot-password, mobile
--    re-verification in profile, and the complaint-filing OTP gate)
-- =====================================================================
DROP TABLE IF EXISTS password_resets;
CREATE TABLE password_resets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  purpose ENUM('password_reset','mobile_verify','complaint_mobile_verify') NOT NULL DEFAULT 'password_reset',
  identifier VARCHAR(255) NOT NULL COMMENT 'email or mobile number the OTP was sent to',
  otp_hash VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_password_resets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_password_resets_identifier (identifier),
  INDEX idx_password_resets_user (user_id)
) ENGINE=InnoDB;

-- =====================================================================
-- 9. COMPLAINTS
-- =====================================================================
DROP TABLE IF EXISTS complaints;
CREATE TABLE complaints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  complaint_code VARCHAR(20) NOT NULL UNIQUE,
  user_id INT NULL COMMENT 'NULL for guest complaints',

  initials VARCHAR(10) NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NULL,
  gender ENUM('Male','Female','Transgender') NOT NULL,

  street_address VARCHAR(255) NOT NULL,
  pincode VARCHAR(6) NOT NULL,
  mobile_number VARCHAR(10) NULL,
  phone_number VARCHAR(15) NULL,
  email VARCHAR(255) NULL,

  zone_id INT NOT NULL,
  ward_number INT NOT NULL,
  locality_id INT NOT NULL,
  street_id INT NOT NULL,
  specific_location VARCHAR(500) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,

  department_id INT NOT NULL,
  complaint_type_id INT NOT NULL,

  title VARCHAR(200) NOT NULL,
  description VARCHAR(400) NOT NULL,
  media_path VARCHAR(500) NULL,

  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  needs_manual_review BOOLEAN NOT NULL DEFAULT FALSE,

  status ENUM(
    'Complaint Filed',
    'Pending Approval',
    'Approved by Department Officer',
    'In Progress',
    'Completed - Pending Collector Verification',
    'Verified by Collector',
    'Rejected'
  ) NOT NULL DEFAULT 'Complaint Filed',
  rejected_stage ENUM('Department Officer','Collector') NULL,
  remarks VARCHAR(1000) NULL,

  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_complaints_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_complaints_zone FOREIGN KEY (zone_id) REFERENCES zones(id),
  CONSTRAINT fk_complaints_locality FOREIGN KEY (locality_id) REFERENCES localities(id),
  CONSTRAINT fk_complaints_street FOREIGN KEY (street_id) REFERENCES streets(id),
  CONSTRAINT fk_complaints_department FOREIGN KEY (department_id) REFERENCES departments(id),
  CONSTRAINT fk_complaints_type FOREIGN KEY (complaint_type_id) REFERENCES complaint_types(id),

  INDEX idx_complaints_user (user_id),
  INDEX idx_complaints_status (status),
  INDEX idx_complaints_department (department_id),
  INDEX idx_complaints_code (complaint_code)
) ENGINE=InnoDB;

-- =====================================================================
-- 10. COMPLAINT STATUS HISTORY
-- =====================================================================
DROP TABLE IF EXISTS complaint_status_history;
CREATE TABLE complaint_status_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  complaint_id INT NOT NULL,
  status VARCHAR(100) NOT NULL,
  stage VARCHAR(100) NULL,
  remarks VARCHAR(1000) NULL,
  changed_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_history_complaint FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE,
  CONSTRAINT fk_history_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_history_complaint (complaint_id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- 11. SAMPLE USERS (1 per role)
-- This schema intentionally does NOT hard-code a bcrypt password hash
-- here (a wrong/incompatible hash would silently break login). Instead,
-- after running `npm install`, run:
--     node scripts/seed-users.js
-- which creates these 3 accounts (collector, department_officer,
-- citizen) with a real bcrypt hash of the password "Passw0rd!" computed
-- on your machine with the exact bcryptjs version you installed.
-- You can also simply register fresh accounts via /register.
-- =====================================================================
