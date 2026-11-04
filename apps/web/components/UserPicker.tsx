'use client';

import { Button, Group, Modal, Select, TextInput } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconUserPlus } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api, queryKeys } from '@/lib/api';
import { shortAddress } from '@/lib/format';
import type { UserPickerProps } from './UserPicker.types';

export function UserPicker({ value, onChange }: UserPickerProps) {
  const qc = useQueryClient();
  const [opened, { open, close }] = useDisclosure(false);
  const [name, setName] = useState('');

  const users = useQuery({ queryKey: queryKeys.users, queryFn: api.listUsers });

  const create = useMutation({
    mutationFn: (n: string) => api.createUser(n),
    onSuccess: async (user) => {
      await qc.invalidateQueries({ queryKey: queryKeys.users });
      notifications.show({ color: 'green', title: 'Пользователь создан', message: `Адрес: ${user.address}` });
      setName('');
      close();
      onChange(user.id);
    },
    onError: (e) => notifications.show({ color: 'red', title: 'Не удалось создать пользователя', message: e.message }),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate(name.trim());
  };

  return (
    <Group gap="xs">
      <Select
        w={280}
        placeholder={users.isLoading ? 'Загрузка…' : 'Выберите пользователя'}
        data={(users.data ?? []).map((u) => ({ value: u.id, label: `${u.name} · ${shortAddress(u.address, 4)}` }))}
        value={value}
        onChange={onChange}
        searchable
        nothingFoundMessage="Нет пользователей"
        error={users.isError ? users.error.message : undefined}
        allowDeselect={false}
      />
      <Button leftSection={<IconUserPlus size={16} />} variant="light" onClick={open}>
        Новый
      </Button>

      <Modal opened={opened} onClose={close} title="Новый пользователь">
        <form onSubmit={submit}>
          <TextInput
            label="Имя"
            placeholder="Alice"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            maxLength={100}
            data-autofocus
            required
          />
          <Group justify="flex-end" mt="md">
            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
              Создать (кошелёк Circle)
            </Button>
          </Group>
        </form>
      </Modal>
    </Group>
  );
}
