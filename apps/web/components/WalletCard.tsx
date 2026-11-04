'use client';

import {
  ActionIcon,
  Anchor,
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
import { IconCheck, IconCopy, IconExternalLink, IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, ApiRequestError, queryKeys } from '@/lib/api';
import { addressExplorerUrl, FAUCET_URL } from '@/lib/format';

export const REFRESH_MS = 4000;

export function WalletCard({ userId, onMissing }: { userId: string; onMissing: () => void }) {
  const qc = useQueryClient();
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
      notifications.show({ message: `Синхронизировано с Circle, обработано операций: ${updated}` });
    },
    onError: (e) => notifications.show({ color: 'red', title: 'Ошибка синхронизации', message: e.message }),
  });

  if (user.isLoading) return <Loader />;
  if (!user.data) return <Text c="red">{user.error?.message ?? 'Ошибка загрузки'}</Text>;
  const u = user.data;
  const explorer = addressExplorerUrl(u.blockchain, u.address);

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={3}>{u.name}</Title>
          <Text size="sm" c="dimmed">
            Адрес для пополнения ({u.blockchain})
          </Text>
          <Group gap={4}>
            <Code fz="sm">{u.address}</Code>
            <CopyButton value={u.address}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Скопировано' : 'Копировать'}>
                  <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
            {explorer && (
              <Tooltip label="Открыть в обозревателе">
                <ActionIcon variant="subtle" color="gray" component="a" href={explorer} target="_blank">
                  <IconExternalLink size={16} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
          <Text size="sm">
            Тестовые USDC:{' '}
            <Anchor href={FAUCET_URL} target="_blank">
              faucet.circle.com
            </Anchor>{' '}
            → сеть Base Sepolia → вставьте адрес выше.
          </Text>
        </Stack>
        <Button
          variant="default"
          leftSection={<IconRefresh size={16} />}
          loading={sync.isPending}
          onClick={() => sync.mutate()}
        >
          Синхронизировать с Circle
        </Button>
      </Group>

      <Title order={5} mt="lg" mb="xs">
        Баланс
      </Title>
      {u.balances.length === 0 ? (
        <Text c="dimmed" size="sm">
          Пока пусто — пополните кошелёк. Пополнение появится после вебхука от Circle.
        </Text>
      ) : (
        <Table withTableBorder={false} verticalSpacing="xs" maw={560}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Токен</Table.Th>
              <Table.Th ta="right">Доступно</Table.Th>
              <Table.Th ta="right">Поступает</Table.Th>
              <Table.Th ta="right">Выводится</Table.Th>
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
