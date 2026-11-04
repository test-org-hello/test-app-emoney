'use client';

import { Anchor, Badge, Card, Group, Loader, ScrollArea, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowDownLeft, IconArrowUpRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { Transaction, TransactionStatus } from '@circle-wallet/shared';
import { api, queryKeys } from '@/lib/api';
import { formatDate, shortAddress } from '@/lib/format';
import { REFRESH_MS } from './WalletCard';

const STATUS: Record<TransactionStatus, { color: string; label: string }> = {
  pending: { color: 'yellow', label: 'В обработке' },
  completed: { color: 'green', label: 'Выполнен' },
  failed: { color: 'red', label: 'Не выполнен' },
};

function Row({ tx }: { tx: Transaction }) {
  const isDeposit = tx.direction === 'deposit';
  const s = STATUS[tx.status];
  const counterparty = isDeposit ? tx.sourceAddress : tx.destinationAddress;

  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm">{formatDate(tx.createdAt)}</Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {isDeposit ? <IconArrowDownLeft size={16} color="teal" /> : <IconArrowUpRight size={16} color="orange" />}
          <Text size="sm">{isDeposit ? 'Пополнение' : 'Вывод'}</Text>
        </Group>
      </Table.Td>
      <Table.Td ta="right">
        <Text size="sm" fw={600} c={isDeposit ? 'teal' : undefined}>
          {isDeposit ? '+' : '−'}
          {tx.amount} {tx.token.symbol}
        </Text>
      </Table.Td>
      <Table.Td>
        <Tooltip label={counterparty ?? ''} disabled={!counterparty}>
          <Text size="sm" ff="monospace">
            {isDeposit ? 'от ' : 'на '}
            {shortAddress(counterparty, 4)}
          </Text>
        </Tooltip>
      </Table.Td>
      <Table.Td>
        <Tooltip label={tx.errorReason ?? ''} disabled={!tx.errorReason} multiline w={300}>
          <Badge color={s.color} variant="light">
            {s.label}
          </Badge>
        </Tooltip>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {tx.circleState ?? '—'}
        </Text>
      </Table.Td>
      <Table.Td>
        {tx.explorerUrl ? (
          <Anchor href={tx.explorerUrl} target="_blank" size="sm" ff="monospace">
            {shortAddress(tx.txHash, 4)}
          </Anchor>
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

export function TransactionsTable({ userId }: { userId: string }) {
  const txs = useQuery({
    queryKey: queryKeys.transactions(userId),
    queryFn: () => api.listTransactions(userId),
    refetchInterval: REFRESH_MS,
  });

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={4}>История операций</Title>
        {txs.isFetching && <Loader size="xs" />}
      </Group>
      {txs.isError ? (
        <Text c="red">{txs.error.message}</Text>
      ) : !txs.data ? (
        <Loader />
      ) : txs.data.length === 0 ? (
        <Text c="dimmed" size="sm">
          Операций пока нет.
        </Text>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover miw={800}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Дата</Table.Th>
                <Table.Th>Тип</Table.Th>
                <Table.Th ta="right">Сумма</Table.Th>
                <Table.Th>Контрагент</Table.Th>
                <Table.Th>Статус</Table.Th>
                <Table.Th>Circle</Table.Th>
                <Table.Th>Tx</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {txs.data.map((tx) => (
                <Row key={tx.id} tx={tx} />
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
    </Card>
  );
}
