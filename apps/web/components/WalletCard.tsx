'use client';

import {
  ActionIcon,
  Button,
  Card,
  Code,
  CopyButton,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useDisclosure } from '@mantine/hooks';
import { IconCheck, IconCopy, IconExternalLink, IconPlus, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';
import { useErrorMessage } from '@/lib/errors';
import { api, ApiRequestError, queryKeys } from '@/lib/api';
import { addressExplorerUrl } from '@/lib/format';
import { DepositModal } from './DepositModal';
import type { WalletCardProps } from './WalletCard.types';

export const REFRESH_MS = 4000;

export function WalletCard({ userId, onMissing }: WalletCardProps) {
  const t = useTranslations('wallet');
  const tc = useTranslations('common');
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const [depositOpened, deposit] = useDisclosure(false);
  const user = useQuery({
    queryKey: queryKeys.user(userId),
    queryFn: () => api.getUser(userId),
    refetchInterval: REFRESH_MS,
  });

  useEffect(() => {
    if (user.error instanceof ApiRequestError && user.error.status === 404) onMissing();
  }, [user.error, onMissing]);

  const sync = useMutation({
    mutationFn: () => api.sync(userId),
    onSuccess: async ({ updated }) => {
      await qc.invalidateQueries({ queryKey: queryKeys.user(userId) });
      notifications.show({ message: t('synced', { count: updated }) });
    },
    onError: (e) => notifications.show({ color: 'red', title: t('syncFailed'), message: errorMessage(e) }),
  });

  if (user.isLoading) return <Loader />;
  if (!user.data) return <Text c="red">{user.error ? errorMessage(user.error) : tc('loadError')}</Text>;
  const u = user.data;
  const explorer = addressExplorerUrl(u.blockchain, u.address);

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={3}>{u.name}</Title>
          <Text size="sm" c="dimmed">
            {t('depositAddress', { blockchain: u.blockchain })}
          </Text>
          <Group gap={4}>
            <Code fz="sm">{u.address}</Code>
            <CopyButton value={u.address}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? tc('copied') : tc('copy')}>
                  <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
            {explorer && (
              <Tooltip label={tc('openInExplorer')}>
                <ActionIcon variant="subtle" color="gray" component="a" href={explorer} target="_blank">
                  <IconExternalLink size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </Stack>
        <Group gap="xs">
          <Button leftSection={<IconPlus size={16} />} onClick={deposit.open}>
            {t('deposit')}
          </Button>
          <Tooltip label={t('syncHint')}>
            <Button
              variant="default"
              leftSection={<IconRefresh size={16} />}
              loading={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {t('sync')}
            </Button>
          </Tooltip>
        </Group>
      </Group>

      <DepositModal user={u} opened={depositOpened} onClose={deposit.close} />

      <Title order={5} mt="lg" mb="xs">
        {t('balance')}
      </Title>
      {u.balances.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('empty')}
        </Text>
      ) : (
        <Table withTableBorder={false} verticalSpacing="xs" maw={560}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('token')}</Table.Th>
              <Table.Th ta="right">{t('available')}</Table.Th>
              <Table.Th ta="right">{t('incoming')}</Table.Th>
              <Table.Th ta="right">{t('outgoing')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {u.balances.map((b) => (
              <Table.Tr key={b.token.id}>
                <Table.Td fw={600}>{b.token.symbol}</Table.Td>
                <Table.Td ta="right" fw={700} fz="lg">
                  {b.available}
                </Table.Td>
                <Table.Td ta="right" c={b.incoming !== '0' ? 'blue' : 'dimmed'}>
                  {b.incoming !== '0' ? `+${b.incoming}` : '—'}
                </Table.Td>
                <Table.Td ta="right" c={b.outgoing !== '0' ? 'orange' : 'dimmed'}>
                  {b.outgoing !== '0' ? `−${b.outgoing}` : '—'}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Card>
  );
}
