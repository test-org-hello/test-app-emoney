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
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import type { User } from '@circle-wallet/shared';
import { api, queryKeys } from '@/lib/api';
import { FAUCET_URL } from '@/lib/format';
import { REFRESH_MS } from './WalletCard';

/**
 * A deposit is an on-chain transfer *to* the user's Circle wallet address
 * (from the faucet or any other wallet). The app cannot pull funds; it shows
 * where to send them and then watches the history until the deposit shows up.
 */
export function DepositModal({ user, opened, onClose }: { user: User; opened: boolean; onClose: () => void }) {
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
    <Modal opened={opened} onClose={onClose} title="Пополнение кошелька" size="lg">
      <Stack gap="md">
        <Text size="sm">
          Отправьте тестовые токены на адрес кошелька пользователя <b>{user.name}</b> в сети{' '}
          <Badge component="span" variant="light" color="grape">
            {user.blockchain}
          </Badge>
          . Пополнение появится в истории автоматически.
        </Text>

        <Group align="center" wrap="nowrap" gap="lg">
          <Box p={8} bg="white" style={{ borderRadius: 8, lineHeight: 0 }}>
            <QRCodeSVG value={user.address} size={132} />
          </Box>
          <Stack gap={6} style={{ minWidth: 0 }}>
            <Text size="xs" c="dimmed">
              Адрес для пополнения
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
                  {copied ? 'Скопировано' : 'Скопировать адрес'}
                </Button>
              )}
            </CopyButton>
          </Stack>
        </Group>

        <Box>
          <Text fw={600} size="sm" mb={4}>
            Как получить тестовые USDC
          </Text>
          <List type="ordered" size="sm" spacing={4}>
            <List.Item>Скопируйте адрес выше.</List.Item>
            <List.Item>
              Откройте фаусет Circle, выберите <b>USDC</b> и сеть <b>Base Sepolia</b>. Проверьте сеть: если фаусет
              по умолчанию предлагает другую (например, Arc Testnet), токены уйдут в неё и сюда не придут.
            </List.Item>
            <List.Item>Вставьте адрес и отправьте запрос. Лимит фаусета: один запрос в 2 часа на адрес и токен.</List.Item>
          </List>
          <Button
            component="a"
            href={FAUCET_URL}
            target="_blank"
            mt="sm"
            leftSection={<IconDroplet size={16} />}
            rightSection={<IconExternalLink size={14} />}
          >
            Открыть faucet.circle.com
          </Button>
        </Box>

        {received ? (
          <Alert color={received.status === 'failed' ? 'red' : 'teal'} icon={<IconCheck />} title="Пополнение получено">
            +{received.amount} {received.token.symbol} —{' '}
            {received.status === 'completed'
              ? 'зачислено на баланс.'
              : received.status === 'failed'
                ? 'перевод не выполнен.'
                : 'ждём подтверждения сети, после этого сумма станет доступна.'}
          </Alert>
        ) : (
          <Alert color="gray" variant="light">
            <Center inline>
              <Loader size="xs" mr="xs" />
              <Text size="sm">
                Ждём входящий перевод. Обычно он появляется через несколько секунд после зачисления в блокчейне
                (вебхук Circle) или в течение 30 секунд (опрос Circle).
              </Text>
            </Center>
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}
