'use client';

import {
  Alert,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconLock, IconWallet } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';

const SessionContext = createContext<Session | null>(null);

/** The signed-in Supabase session (always non-null inside <AuthGate>). */
export const useSession = () => useContext(SessionContext);

/**
 * Test authentication via Supabase Auth (email + password). The app itself is
 * unchanged: any signed-in account sees the user list and can act on any
 * wallet, exactly as in the task scenario; sign-in only locks the UI and API.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Do not leak cached data of one account into another.
      if (event === 'SIGNED_OUT' || event === 'SIGNED_IN') qc.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [qc]);

  if (!ready) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }
  if (!session) return <LoginForm />;
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

function LoginForm() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const creds = { email: email.trim(), password };
    const { data, error } =
      mode === 'signin' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds);
    setLoading(false);

    if (error) {
      setError(error.message === 'Invalid login credentials' ? 'Неверный email или пароль' : error.message);
    } else if (mode === 'signup' && !data.session) {
      // Projects with email confirmation enabled (cloud default) return no session yet.
      setInfo('Аккаунт создан. Подтвердите email по ссылке из письма и войдите.');
      setMode('signin');
    }
  };

  return (
    <Center mih="100vh" p="md">
      <Paper withBorder shadow="md" p="xl" w={400} maw="100%">
        <form onSubmit={submit}>
          <Stack>
            <Group gap="xs">
              <IconWallet size={26} />
              <Title order={3}>Circle Wallet</Title>
            </Group>
            <Text size="sm" c="dimmed">
              Тестовый вход через Supabase Auth.
            </Text>
            <SegmentedControl
              value={mode}
              onChange={(v) => setMode(v as 'signin' | 'signup')}
              data={[
                { value: 'signin', label: 'Вход' },
                { value: 'signup', label: 'Регистрация' },
              ]}
            />
            <TextInput
              label="Email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              autoComplete="email"
              required
            />
            <PasswordInput
              label="Пароль"
              description={mode === 'signup' ? 'Не короче 6 символов' : undefined}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
            {error && (
              <Alert color="red" icon={<IconLock size={16} />}>
                {error}
              </Alert>
            )}
            {info && <Alert color="teal">{info}</Alert>}
            <Button type="submit" loading={loading}>
              {mode === 'signin' ? 'Войти' : 'Зарегистрироваться'}
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}

export function AccountMenu() {
  const session = useSession();
  return (
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" c="dimmed" truncate maw={200} visibleFrom="sm">
        {session?.user.email}
      </Text>
      <Button size="xs" variant="subtle" color="gray" onClick={() => supabase.auth.signOut()}>
        Выйти
      </Button>
    </Group>
  );
}
