'use client';

import { Alert, AppShell, Badge, Container, Group, Stack, Text, Title } from '@mantine/core';
import { IconInfoCircle, IconWallet } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useCallback } from 'react';
import { LocaleSwitcher } from '@/components/LocaleSwitcher';
import { TransactionsTable } from '@/components/TransactionsTable';
import { UserPicker } from '@/components/UserPicker';
import { WalletCard } from '@/components/WalletCard';
import { WithdrawForm } from '@/components/WithdrawForm';

function Home() {
  const t = useTranslations();
  const router = useRouter();
  const params = useSearchParams();
  const userId = params.get('user');

  const selectUser = useCallback(
    (id: string | null) => router.replace(id ? `/?user=${id}` : '/', { scroll: false }),
    [router],
  );

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Container size="lg" h="100%">
          <Group h="100%" justify="space-between">
            <Group gap="xs">
              <IconWallet size={26} />
              <Title order={3}>{t('common.appName')}</Title>
              <Badge variant="light" color="grape">
                {t('common.network')}
              </Badge>
            </Group>
            <Group gap="md" wrap="nowrap">
              <UserPicker value={userId} onChange={selectUser} />
              <LocaleSwitcher />
            </Group>
          </Group>
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        <Container size="lg">
          {userId ? (
            <Stack gap="lg">
              <WalletCard userId={userId} onMissing={() => selectUser(null)} />
              <WithdrawForm key={userId} userId={userId} />
              <TransactionsTable userId={userId} />
            </Stack>
          ) : (
            <Alert icon={<IconInfoCircle />} title={t('home.selectUserTitle')} mt="xl">
              <Text size="sm">{t('home.selectUserText')}</Text>
            </Alert>
          )}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Home />
    </Suspense>
  );
}
