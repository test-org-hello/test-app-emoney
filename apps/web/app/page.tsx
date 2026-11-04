'use client';

import { Alert, AppShell, Badge, Container, Group, Stack, Text, Title } from '@mantine/core';
import { IconInfoCircle, IconWallet } from '@tabler/icons-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback } from 'react';
import { TransactionsTable } from '@/components/TransactionsTable';
import { UserPicker } from '@/components/UserPicker';
import { WalletCard } from '@/components/WalletCard';
import { WithdrawForm } from '@/components/WithdrawForm';

function Home() {
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
              <Title order={3}>Circle Wallet</Title>
              <Badge variant="light" color="grape">
                BASE-SEPOLIA testnet
              </Badge>
            </Group>
            <UserPicker value={userId} onChange={selectUser} />
          </Group>
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        <Container size="lg">
          {userId ? (
            <Stack gap="lg">
              <WalletCard userId={userId} onMissing={() => selectUser(null)} />
              <WithdrawForm userId={userId} />
              <TransactionsTable userId={userId} />
            </Stack>
          ) : (
            <Alert icon={<IconInfoCircle />} title="Выберите пользователя" mt="xl">
              <Text size="sm">
                Создайте пользователя или выберите существующего в правом верхнем углу. У каждого пользователя свой
                кошелёк Circle и свой адрес для пополнения.
              </Text>
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
