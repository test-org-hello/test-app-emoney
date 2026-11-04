/** Position in the history: the (created_at, id) of the last transaction of a page. */
export interface TransactionCursor {
  createdAt: string;
  id: string;
}
