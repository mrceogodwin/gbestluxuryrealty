-- Public G-BEST website contact enquiries, managed from the Super Admin business contacts area.
CREATE TABLE IF NOT EXISTS public.business_contact_submissions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 full_name varchar(120) NOT NULL,
 email varchar(254) NOT NULL,
 phone varchar(40),
 subject varchar(160) NOT NULL,
 message text NOT NULL,
 status varchar(24) NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','responded','closed')),
 admin_note text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS business_contact_submissions_created_idx ON public.business_contact_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS business_contact_submissions_status_idx ON public.business_contact_submissions(status,created_at DESC);
