'use client';

import { Button, Card, Grid, Select, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSend } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { useErrorMessage } from '@/lib/errors';
import type { CreateWithdrawalRequest } from '@circle-wallet/shared';
import { api, ApiRequestError, queryKeys } from '@/lib/api';
import type { WithdrawAttempt, WithdrawFormProps } from './WithdrawForm.types';

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
  const t = useTranslations('withdraw');
  const errorMessage = useErrorMessage();
  const qc = useQueryClient();
  const user = useQuery({ queryKey: queryKeys.user(userId), queryFn: () => api.getUser(userId) });
  const balances = (user.data?.balances ?? []).filter((b) => b.available !== '0');

  // The form is remounted per user (`key={userId}` in the page), so its state never leaks between users.
  const [pickedTokenId, setTokenId] = useState<string | null>(null);
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');
  // Same intent re-submitted (double click, retry after a network error) reuses the key,
  // so the backend returns the first withdrawal instead of creating a second one.
  const [attempt, setAttempt] = useState<WithdrawAttempt | null>(null);

  // Derived, not synced in an effect: the picked token if it still has funds, otherwise the first one.
  const balance = balances.find((b) => b.token.id === pickedTokenId) ?? balances[0];
  const tokenId = balance?.token.id ?? null;
  const decimals = balance?.token.decimals ?? 6;

  const amountError = (() => {
    if (!amount) {
      return null;
    }
    if (!AMOUNT_RE.test(amount)) {
      return t('errorNumber');
    }
    if ((amount.split('.')[1] ?? '').replace(/0+$/, '').length > decimals) {
      return t('errorDecimals', { decimals });
    }
    if (cmpDecimal(amount, '0') <= 0) {
      return t('errorPositive');
    }
    if (balance && cmpDecimal(amount, balance.available) > 0) {
      return t('errorExceeds', { available: balance.available });
    }
    return null;
  })();
  const addressError = destination && !ADDRESS_RE.test(destination.trim()) ? t('errorAddress') : null;

  const withdraw = useMutation({
    mutationFn: ({ req, key }: { req: CreateWithdrawalRequest; key: string }) => api.withdraw(userId, req, key),
    onSuccess: async (tx) => {
      setAttempt(null); // done: the next submit is a new withdrawal
      await Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.user(userId) }),
        qc.invalidateQueries({ queryKey: queryKeys.transactions(userId) }),
      ]);
      setAmount('');
      notifications.show(
        tx.status === 'failed'
          ? { color: 'red', title: t('rejected'), message: tx.errorReason ?? t('rejectedFallback') }
          : {
              color: 'green',
              title: t('sent'),
              message: t('sentMessage', { amount: tx.amount, symbol: tx.token.symbol }),
            },
      );
    },
    onError: (e) => {
      if (e instanceof ApiRequestError && e.code === 'idempotency_key_reused') {
        setAttempt(null);
      }
      notifications.show({ color: 'red', title: t('failed'), message: errorMessage(e) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!tokenId) {
      return;
    }
    const req = { tokenId, destinationAddress: destination.trim(), amount };
    const intent = `${req.tokenId}|${req.destinationAddress.toLowerCase()}|${req.amount}`;
    const current = attempt?.intent === intent ? attempt : { intent, key: crypto.randomUUID() };
    setAttempt(current);
    withdraw.mutate({ req, key: current.key });
  };

  const canSubmit = !!tokenId && !!amount && !!destination && !amountError && !addressError;

  return (
    <Card withBorder padding="lg">
      <Title order={4} mb="sm">
        {t('title')}
      </Title>
      {balances.length === 0 ? (
        <Text c="dimmed" size="sm">
          {t('noFunds')}
        </Text>
      ) : (
        <form onSubmit={submit}>
          <Grid align="flex-start">
            <Grid.Col span={{ base: 12, sm: 2 }}>
              <Select
                label={t('token')}
                data={balances.map((b) => ({ value: b.token.id, label: b.token.symbol }))}
                value={tokenId}
                onChange={setTokenId}
                allowDeselect={false}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 6 }}>
              <TextInput
                label={t('destination')}
                placeholder="0x…"
                value={destination}
                onChange={(e) => setDestination(e.currentTarget.value)}
                error={addressError}
                spellCheck={false}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, sm: 4 }}>
              <TextInput
                label={t('amount')}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.currentTarget.value.replace(',', '.').trim())}
                error={amountError}
                description={
                  balance ? t('availableHint', { amount: balance.available, symbol: balance.token.symbol }) : undefined
                }
                // Hint under the input (Mantine puts it between label and input by default),
                // so all three inputs of the row stay on one line.
                inputWrapperOrder={['label', 'input', 'description', 'error']}
                inputMode="decimal"
                rightSectionWidth={60}
                rightSection={
                  <Button size="compact-xs" variant="subtle" onClick={() => balance && setAmount(balance.available)}>
                    {t('max')}
                  </Button>
                }
              />
            </Grid.Col>
          </Grid>
          <Button
            type="submit"
            mt="md"
            leftSection={<IconSend size={16} />}
            loading={withdraw.isPending}
            disabled={!canSubmit}
          >
            {t('submit')}
          </Button>
        </form>
      )}
    </Card>
  );
}
