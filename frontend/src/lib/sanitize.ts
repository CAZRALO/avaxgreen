export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function sanitizeOnChainText(value: string, maxBytes: number): string {
  const cleaned = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\x00-\x1F"\\<>&]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  let out = '';
  const encoder = new TextEncoder();
  for (const ch of cleaned) {
    if (encoder.encode(out + ch).length > maxBytes) break;
    out += ch;
  }
  return out;
}

export function validateOnChainText(value: string, maxBytes: number, fieldLabel: string): string | null {
  const normalized = value.replace(/[\r\n\t]+/g, ' ').trim();
  if (!normalized) {
    return `Vui lòng nhập ${fieldLabel}.`;
  }
  if (/[\x00-\x1F"\\<>&]/.test(normalized)) {
    return `${fieldLabel} không được chứa ký tự đặc biệt (", \\, <, >, &) để bảo vệ metadata on-chain.`;
  }
  const bytes = utf8ByteLength(normalized);
  if (bytes > maxBytes) {
    return `${fieldLabel} vượt quá giới hạn ${maxBytes} bytes UTF-8 (hiện tại: ${bytes} bytes).`;
  }
  return null;
}

export function formatAvaxError(err: unknown): string {
  const raw =
    (err as {shortMessage?: string; details?: string; message?: string})?.shortMessage ||
    (err as {details?: string; message?: string})?.details ||
    (err instanceof Error ? err.message : String(err || ''));

  const lower = raw.toLowerCase();

  if (lower.includes('user rejected') || lower.includes('user denied') || lower.includes('4001')) {
    return 'Bạn đã hủy giao dịch trên ví.';
  }
  if (lower.includes('proof already used')) {
    return 'Bằng chứng này đã được sử dụng để mint trước đó (chống gian lận replay).';
  }
  if (lower.includes('invalid oracle')) {
    return 'Chữ ký Oracle không hợp lệ hoặc không khớp với hợp đồng trên chuỗi.';
  }
  if (lower.includes('insufficient verified inventory')) {
    return 'Kho tín chỉ đã xác minh trong Marketplace hiện không đủ.';
  }
  if (lower.includes('insufficient funds')) {
    return 'Ví không đủ test AVAX để thanh toán và trả phí gas trên Fuji.';
  }
  if (lower.includes('erc20insufficientallowance')) {
    return 'Chưa cấp quyền (Approve) GCARB cho CarbonRegistry.';
  }
  if (lower.includes('erc20insufficientbalance')) {
    return 'Số dư token GCARB trong ví không đủ.';
  }
  if (lower.includes('unsafe metadata character') || lower.includes('text length')) {
    return 'Tên công ty hoặc lý do chứa ký tự không hợp lệ hoặc quá dài.';
  }
  if (lower.includes('use multiples of 0.0001 avax')) {
    return 'Số lượng mua phải là số nguyên GCARB (bội số 0.0001 AVAX).';
  }
  if (lower.includes('timeout') || lower.includes('fetch') || lower.includes('network')) {
    return 'Kết nối RPC Avalanche Fuji tạm thời gián đoạn. Vui lòng thử lại.';
  }
  return raw ? raw.slice(0, 180) : 'Giao dịch thất bại.';
}
