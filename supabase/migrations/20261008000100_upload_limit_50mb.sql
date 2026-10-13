-- 0100 — Bigger files (Dana, Oct 13): a WFS sales report spreadsheet would not upload ("Failed to fetch"). The vendor
-- files bucket takes files up to 50 MB (was 25 MB); the app checks the size first and says so plainly.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets set file_size_limit = 52428800 where id = 'vendor-files';
  end if;
end $$;
