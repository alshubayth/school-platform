-- جرد قاعدة البيانات (قراءة فقط - ما يغيّر أي شي)
-- يطلع صف واحد فيه JSON: كل جدول، أعمدته، هل فيه school_id، كم صف بدون school_id، حالة RLS، والسياسات الحالية
with t as (
  select c.oid, c.relname as table_name, c.relrowsecurity as rls_enabled
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
),
cols as (
  select table_name, json_agg(json_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable) order by ordinal_position) as columns,
         bool_or(column_name = 'school_id') as has_school_id
  from information_schema.columns where table_schema = 'public' group by table_name
),
pol as (
  select tablename as table_name, json_agg(json_build_object('name', policyname, 'cmd', cmd, 'roles', roles, 'using', qual, 'check', with_check)) as policies
  from pg_policies where schemaname = 'public' group by tablename
),
fk as (
  select tc.table_name, json_agg(json_build_object('column', kcu.column_name, 'ref', ccu.table_name || '.' || ccu.column_name)) as fks
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
  join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
  where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public' group by tc.table_name
)
select json_build_object(
  'tables', (select json_agg(json_build_object(
      'table', t.table_name, 'rls', t.rls_enabled, 'has_school_id', coalesce(cols.has_school_id, false),
      'rows', (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.table_name), false, true, '')))[1]::text,
      'rows_without_school', case when cols.has_school_id then (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I where school_id is null', t.table_name), false, true, '')))[1]::text end,
      'columns', cols.columns, 'policies', pol.policies, 'fks', fk.fks) order by t.table_name)
    from t left join cols using (table_name) left join pol using (table_name) left join fk using (table_name)),
  'schools', (select json_agg(json_build_object('id', id, 'name', name)) from public.schools),
  'profile_roles', (select json_agg(r) from (select role, count(*) n, count(*) filter (where school_id is null) no_school from public.profiles group by role) r),
  'functions', (select json_agg(p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public')
) as inventory;
