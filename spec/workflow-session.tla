---- MODULE workflow-session ----
EXTENDS Naturals, Sequences

CONSTANT Nodes

VARIABLES runStatus, activeLease, activeHeartbeat, pendingCompletionReceipt, preparedCompletionReceipt, acknowledgedCompletionReceipt

Init ==
  /\ runStatus = "running"
  /\ activeLease = NULL
  /\ activeHeartbeat = NULL
  /\ pendingCompletionReceipt = NULL
  /\ preparedCompletionReceipt = NULL
  /\ acknowledgedCompletionReceipt = NULL

LeaseRequiredForRunning ==
  runStatus = "running" => activeLease # NULL

PreparedRequiresPendingReceipt ==
  preparedCompletionReceipt # NULL => pendingCompletionReceipt # NULL

CommitRequiresPreparedReceipt ==
  acknowledgedCompletionReceipt # NULL => preparedCompletionReceipt # NULL

NoPreparedReceiptAfterTerminal ==
  runStatus \in {"completed", "failed", "cancelled", "paused_for_human"} => preparedCompletionReceipt = NULL

====
