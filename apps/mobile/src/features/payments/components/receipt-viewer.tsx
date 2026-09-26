import { SecureFileViewer } from "@/components/secure-file-viewer";
import { useT } from "@/core/i18n";

type Props = {
  paymentId: string | null; // null = cerrado
  onClose: () => void;
};

/** Visor del comprobante de pago (descifrado por el backend, sin caché). */
export function ReceiptViewer({ paymentId, onClose }: Props) {
  const { t } = useT();
  return (
    <SecureFileViewer
      path={paymentId ? `/payments/${paymentId}/receipt` : null}
      title={t("payment.receipt.title")}
      onClose={onClose}
    />
  );
}
