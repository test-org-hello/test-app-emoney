-- Local test data, applied by `supabase start` / `supabase db reset` (see config.toml [db.seed]).
-- Not applied by `supabase db push`, so it never reaches a cloud project.
--
-- Test sign-in account for the web app:
--   email:    demo@example.com
--   password: demo12345

do $$
declare
  v_email    text := 'demo@example.com';
  v_password text := 'demo12345';
  v_id       uuid := gen_random_uuid();
begin
  if exists (select 1 from auth.users where email = v_email) then
    return;
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', ''
  );

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
    'email', now(), now(), now()
  );
end
$$;
