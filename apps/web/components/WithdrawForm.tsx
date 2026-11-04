'use client';

import { Button, Card, Grid, Select, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSend } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { api, queryKeys } from '@/lib/api';
import type { WithdrawFormProps } from './WithdrawForm.types';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT_RE = /^\d+(\.\d+)?$/;

/** Compare two non-negative decimal strings without floats. */
function cmpDecimal(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.');
  const [bi = '0', bf = ''] = b.split('.');
  const len = Math.max(af.length, bf.length);
  const x = BigInt(ai + af.padEnd(len, '0'));
  const y = BigInt(bi + bf.padEnd(len, '0'));
  return x === y ? 0 : x > y ? 1 : -1;
}

export function WithdrawForm({ userId }: WithdrawFormProps) {
  const qc = useQueryClient();
  const user = useQuery({ queryKey: queryKeys.user(userId), queryFn: () => api.getUser(userId) });
  const balances = (user.data?.balances ?? []).filter((b) => b.available !== '0');

  const [tokenId, setTokenId] = useState<string | null>(null);
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');

  useEffect(() => {
    if (!tokenId || !balances.some((b) => b.token.id === tokenId)) setTokenId(balances[0]?.token.id ?? null);
  }, [balances, tokenId]);

  useEffect(() => {
    setDestination('');
    setAmount('');
  }, [userId]);

  const balance = balances.find((b) => b.token.id === tokenId);
  const decimals = balance?.token.decimals ?? 6;

  const amountError = (() => {
    if (!amount) return null;
    if (!AMOUNT_RE.test(amount)) return 'Введите число, например 1.5';
    if ((amount.split('.')[1] ?? '').length > decimals) return `Не более ${decimals} знаков после точки`;
    if (cmpDecimal(amount, '0') <= 0) return 'Сумма должна быть больше нуля';
    if (balance && cmpDecimal(amount, balance.available) > 0) return `Доступно только ${balance.available}`;
    return null;
  })();
  const addressError = destination && !ADDRESS_RE.test(destination.trim()) ? 'Нужен EVM-адрес 0x…' : null;

  const withdraw = useMutation({
    mutationFn: () => api.withdraw(userId, { tokenId: tokenId!, destinationAddress: destination.trim(), amount }),
    onSuccess: async (tx) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.user(userId) }),
        qc.invalidateQueries({ queryKey: queryKeys.transactions(userId) }),
      ]);
      setAmount('');
      notifications.show(
        tx.status === 'failed'
          ? { color: 'red', title: 'Вывод отклонён', message: tx.errorReason ?? 'Circle отклонил перевод' }
          : { color: 'green', title: 'Вывод отправлен', message: `${tx.amount} ${tx.token.symbol} — статус в истории` },
      );
    },
    onError: (e) => notifications.show({ color: 'red', title: 'Вывод не создан', message: e.message }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    withdraw.mutate();
  };

  const canSubmit = !!tokenId && !!amount && !!destination && !amountError && !addressError;

  return (
    <Card withBorder padding="lg">
      <Title order={4} mb="sm">
        Вывод
      </Title>
      {balances.length === 0 ? (
        <Text c="dimmed" size="sm">
          Нет доступных средств для вывода.
        </Text>
      ) : (
        <form onSubmit={submit}>
          <Grid align="flex-start">
            <Grid.Col span={{ base: 12, sm: 2 }}>
              <Select
                label="Токен"
                data={balances.map((b) => ({ value: b.token.id, label: b.token.symbol }))}
                value={tokenId}
                onChange={setTokenId}
                allowDeselect={false}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label="Адрес получателя"
                placeholder="0x…"
                value={destination}
                onChange={(e) => setDestination(e.currentTarget.value)}
                error={addressError}
                spellCheck={false}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput
                label="Сумма"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.currentTarget.value.replace(',', '.').trim())}
                error={amountError}
                description={balance ? `Доступно: ${balance.available} ${balance.token.symbol}` : undefined}
                inputMode="decimal"
                rightSectionWidth={60}
                rightSection={
                  <Button size="compact-xs" variant="subtle" onClick={() => balance && setAmount(balance.available)}>
                    MAX
                  </Button>
                }
              />
            </Grid.Col>
          </Grid>
          <Button type="submit" mt="md" leftSection={<IconSend size={16} />} loading={withdraw.isPending} disabled={!canSubmit}>
            Вывести
          </Button>
        </form>
      )}
    </Card>
  );
}
