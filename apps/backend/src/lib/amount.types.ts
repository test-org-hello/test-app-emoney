export type ParseAmountError = 'format' | 'decimals' | 'zero';

export type ParseAmountResult = { ok: true; value: string } | { ok: false; error: ParseAmountError; reason: string };
