export interface UserPickerProps {
  /** Selected user id, or null when none is selected. */
  value: string | null;
  onChange: (id: string | null) => void;
}
