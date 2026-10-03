-- Lot B dark mode : préférence de thème par utilisateur.
CREATE TYPE "ThemePreference" AS ENUM ('system', 'light', 'dark');

ALTER TABLE "users"
  ADD COLUMN "theme" "ThemePreference" NOT NULL DEFAULT 'system';
