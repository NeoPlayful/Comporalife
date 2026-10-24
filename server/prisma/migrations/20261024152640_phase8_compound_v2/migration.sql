-- AlterTable
ALTER TABLE "simulation_scenarios" ADD COLUMN     "annual_contribution_increase" DECIMAL(10,6) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_rate" DECIMAL(10,6) NOT NULL DEFAULT 0,
ADD COLUMN     "withdrawal_amount" DECIMAL(20,6) NOT NULL DEFAULT 0,
ADD COLUMN     "withdrawal_frequency" "ContributionFrequency" NOT NULL DEFAULT 'none',
ADD COLUMN     "withdrawal_start_year" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "model_version" SET DEFAULT 'compound-v2';
