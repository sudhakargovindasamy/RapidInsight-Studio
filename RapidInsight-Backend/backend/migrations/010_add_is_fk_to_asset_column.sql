-- Add is_fk column to public.asset_column for Foreign Key metadata tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'asset_column' 
      AND column_name = 'is_fk'
  ) THEN
    ALTER TABLE public.asset_column ADD COLUMN is_fk BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

