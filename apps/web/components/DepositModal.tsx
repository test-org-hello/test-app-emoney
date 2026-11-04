'use client';

import {
  Alert,
  Badge,
  Box,
  Button,
  Center,
  Code,
  CopyButton,
  Group,
  List,
  Loader,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import { IconCheck, IconCopy, IconDroplet, IconExternalLink } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { api, queryKeys } from '@/lib/api';
import { FAUCET_URL } from '@/lib/format';
import { REFRESH_MS } from './WalletCard';
import type { DepositModalProps } from './DepositModal.types';

/**
 * A deposit is an on-chain transfer *to* the user's Circle wallet address
 * (from the faucet or any other wallet). The app cannot pull funds; it shows
 * where to send them and then watches the history until the deposit shows up.
 */
export function DepositModal({ user, opened, onClose }: DepositModalProps) {
  const t = useTranslations('deposit');
  const tc = useTranslations('common');
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  useEffect(() => {
    if (opened) setOpenedAt(Date.now());
  }, [opened]);

  const txs = useQuery({
    queryKey: queryKeys.transactions(user.id),
    queryFn: () => api.listTransactions(user.id),
    refetchInterval: REFRESH_MS,
    enabled: opened,
  });
  const received = (txs.data ?? []).find((t) => t.direction === 'deposit' && Date.parse(t.createdAt) >= openedAt - 5_000);

  return (
    <Modal opened={opened} onClose={onClose} title={t('title')} size="lg">
      <Stack gap="md">
        <Text size="sm">
          {t.rich('intro', {
            name: user.name,
            blockchain: user.blockchain,
            network: (chunks) => (
              <Badge component="span" variant="light" color="grape">
                {chunks}
              </Badge>
            ),
            b: (chunks) => <b>{chunks}</b>,
          })}
        </Text>

        <Group align="center" wrap="nowrap" gap="lg">
          <Box p={8} bg="white" style={{ borderRadius: 8, lineHeight: 0 }}>
            <QRCodeSVG value={user.address} size={132} />
          </Box>
          <Stack gap={6} style={{ minWidth: 0 }}>
            <Text size="xs" c="dimmed">
              {t('addressLabel')}
            </Text>
            <Code fz="sm" style={{ wordBreak: 'break-all' }}>
              {user.address}
            </Code>
            <CopyButton value={user.address}>
              {({ copied, copy }) => (
                <Button
                  size="xs"
                  variant={copied ? 'light' : 'default'}
                  color={copied ? 'teal' : undefined}
                  leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  onClick={copy}
                  w="fit-content"
                >
                  {copied ? tc('copied') : t('copyAddress')}
                </Button>
              )}
            </CopyButton>
          </Stack>
        </Group>

        <Box>
          <Text fw={600} size="sm" mb={4}>
            {t('howTo')}
          </Text>
          <List type="ordered" size="sm" spacing={4}>
            <List.Item>{t('step1')}</List.Item>
            <List.Item>{t.rich('step2', { b: (chunks) => <b>{chunks}</b> })}</List.Item>
            <List.Item>{t('step3')}</List.Item>
          </List>
          <Button
            component="a"
            href={FAUCET_URL}
            target="_blank"
            mt="sm"
            leftSection={<IconDroplet size={16} />}
            rightSection={<IconExternalLink size={14} />}
          >
            {t('openFaucet')}
          </Button>
        </Box>

        {received ? (
          <Alert color={received.status === 'failed' ? 'red' : 'teal'} icon={<IconCheck />} title={t('received')}>
            {t(
              received.status === 'completed'
                ? 'receivedCompleted'
                : received.status === 'failed'
                  ? 'receivedFailed'
                  : 'receivedPending',
              { amount: received.amount, symbol: received.token.symbol },
            )}
          </Alert>
        ) : (
          <Alert color="gray" variant="light">
            <Center inline>
              <Loader size="xs" mr="xs" />
              <Text size="sm">{t('waiting')}</Text>
            </Center>
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
