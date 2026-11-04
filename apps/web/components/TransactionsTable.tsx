'use client';

import { Anchor, Badge, Card, Group, Loader, ScrollArea, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconArrowDownLeft, IconArrowUpRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useErrorMessage } from '@/lib/errors';
import type { TransactionStatus } from '@circle-wallet/shared';
import { api, queryKeys } from '@/lib/api';
import { formatDate, shortAddress } from '@/lib/format';
import { REFRESH_MS } from './WalletCard';
import type { StatusBadge, TransactionRowProps, TransactionsTableProps } from './TransactionsTable.types';

const STATUS: Record<TransactionStatus, StatusBadge> = {
  pending: { color: 'yellow', labelKey: 'statusPending' },
  completed: { color: 'green', labelKey: 'statusCompleted' },
  failed: { color: 'red', labelKey: 'statusFailed' },
};

function Row({ tx }: TransactionRowProps) {
  const t = useTranslations('history');
  const locale = useLocale();
  const isDeposit = tx.direction === 'deposit';
  const s = STATUS[tx.status];
  const counterparty = isDeposit ? tx.sourceAddress : tx.destinationAddress;

  return (
    <Table.Tr>
      <Table.Td>
        <Text size="sm">{formatDate(tx.createdAt, locale)}</Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {isDeposit ? <IconArrowDownLeft size={16} color="teal" /> : <IconArrowUpRight size={16} color="orange" />}
          <Text size="sm">{isDeposit ? t('deposit') : t('withdrawal')}</Text>
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
            {t(isDeposit ? 'from' : 'to', { address: shortAddress(counterparty, 4) })}
          </Text>
        </Tooltip>
      </Table.Td>
      <Table.Td>
        <Tooltip label={tx.errorReason ?? ''} disabled={!tx.errorReason} multiline w={300}>
          <Badge color={s.color} variant="light">
            {t(s.labelKey)}
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

export function TransactionsTable({ userId }: TransactionsTableProps) {
  const t = useTranslations('history');
  const errorMessage = useErrorMessage();
  const txs = useQuery({
    queryKey: queryKeys.transactions(userId),
    queryFn: () => api.listTransactions(userId),
    refetchInterval: REFRESH_MS,
  });

  return (
    <Card withBorder padding="lg">
      <Group justify="space-between" mb="sm">
        <Title order={4}>{t('title')}</Title>
        {txs.isFetching && <Loader size="xs" />}
      </Group>
      {txs.isError ? (
        <Text c="red">{errorMessage(txs.error)}</Text>
      ) : !txs.data ? (
        <Loader />
      ) : txs.data.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('empty')}
        </Text>
      ) : (
        <ScrollArea>
          <Table striped highlightOnHover miw={800}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('date')}</Table.Th>
                <Table.Th>{t('type')}</Table.Th>
                <Table.Th ta="right">{t('amount')}</Table.Th>
                <Table.Th>{t('counterparty')}</Table.Th>
                <Table.Th>{t('status')}</Table.Th>
                <Table.Th>{t('circle')}</Table.Th>
                <Table.Th>{t('tx')}</Table.Th>
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
