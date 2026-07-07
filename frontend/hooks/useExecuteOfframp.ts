import { useEffect, useCallback, useRef } from "react";
import { useAccount, useChainId } from "wagmi";
import { type Address } from "viem";
import { useFormStore } from "@/stores/formStore";
import { useExecutionStore } from "@/stores/executionStore";
import { useIntentsStore } from "@/stores/intentsStore";
import { useCreateIntent } from "./useCreateIntent";
import { useApproveUSDC } from "./useApproveUSDC";
import { useCommitQuote } from "./useCommitQuote";
import { usePollFulfillment } from "./usePollFulfillment";
import { fetchOnChainQuotes, type RTPNQuote } from "@/lib/quotes";
import { friendlyTxError } from "@/lib/tx-errors";

export function useExecuteOfframp() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { amount, currency, receivingInfo, recipientName, selectedQuote } = useFormStore();
  const {
    view,
    steps,
    intentId,
    setView,
    setStepStatus,
    setIntentId,
    setError,
    reset: resetExecution,
  } = useExecutionStore();

  const createIntentHook = useCreateIntent();
  const approveHook = useApproveUSDC(address);
  const commitHook = useCommitQuote();

  // Track which effects have run to prevent re-execution
  const hasStartedQuotePoll = useRef(false);
  const hasStartedApproval = useRef(false);
  const hasStartedCommit = useRef(false);

  // Start execution
  const startExecution = useCallback(() => {
    hasStartedQuotePoll.current = false;
    hasStartedApproval.current = false;
    hasStartedCommit.current = false;
    resetExecution();
    setView("execution");
    setStepStatus("createIntent", "pending");
    createIntentHook.createIntent(amount, currency);
  }, [amount, currency, resetExecution, setView, setStepStatus, createIntentHook]);

  // Step 1: Create Intent — watch for success
  useEffect(() => {
    if (createIntentHook.isSuccess && createIntentHook.intentId) {
      setStepStatus("createIntent", "done", { txHash: createIntentHook.hash });
      setIntentId(createIntentHook.intentId);

      // Persist for the "Your intents" panel so this intent can be reclaimed later.
      // Read form values via getState() (same pattern as proceedToCommit) to avoid
      // widening this effect's dependency array.
      const form = useFormStore.getState();
      useIntentsStore.getState().addIntent({
        intentId: createIntentHook.intentId,
        createdAt: Date.now(),
        amountUsdc: form.amount,
        currency: form.currency,
        receivingInfo: form.receivingInfo,
        recipientName: form.recipientName,
      });

      // Start polling for on-chain quotes
      if (!hasStartedQuotePoll.current) {
        hasStartedQuotePoll.current = true;
        const usdcAmount = parseFloat(amount);
        let pollCount = 0;

        const pollForQuotes = async () => {
          try {
            const realQuotes = await fetchOnChainQuotes(createIntentHook.intentId!, usdcAmount, chainId);
            if (realQuotes.length > 0) {
              // Found quotes — proceed to approve
              // Bind to the exact quote the user reviewed (solver AND rtpn). Do
              // not silently fall back to a different solver's quote.
              const matchingQuote = realQuotes.find(
                (q) =>
                  q.rtpn === selectedQuote?.rtpn &&
                  q.solver?.address?.toLowerCase() ===
                    selectedQuote?.solver?.address?.toLowerCase()
              );
              if (!matchingQuote) {
                setError("The quote you selected is no longer available. Please retry.");
                return;
              }

              useFormStore.getState().setSelectedQuote(matchingQuote);
              proceedToApproval();
              return;
            }
          } catch (err) {
            console.error("Error polling quotes:", err);
          }
          pollCount++;
          if (pollCount < 30) {
            setTimeout(pollForQuotes, 2000);
          } else {
            setError("No quotes received from solvers. Please try again.");
          }
        };

        setTimeout(pollForQuotes, 3000);
      }
    }

    if (createIntentHook.error) {
      const friendly = friendlyTxError(createIntentHook.error).message;
      setStepStatus("createIntent", "failed", { error: friendly });
      setError(friendly);
    }
  }, [createIntentHook.isSuccess, createIntentHook.intentId, createIntentHook.hash, createIntentHook.error]);

  // Proceed to approval step
  const proceedToApproval = useCallback(() => {
    if (hasStartedApproval.current) return;
    hasStartedApproval.current = true;

    if (approveHook.needsApproval(amount)) {
      setStepStatus("approve", "pending");
      approveHook.approve(amount);
    } else {
      setStepStatus("approve", "skipped");
      proceedToCommit();
    }
  }, [amount, approveHook, setStepStatus]);

  // Step 2: Approve — watch for success
  useEffect(() => {
    if (approveHook.isSuccess && steps.find((s) => s.id === "approve")?.status === "pending") {
      setStepStatus("approve", "done", { txHash: approveHook.hash });
      approveHook.refetchAllowance();
      proceedToCommit();
    }
    if (approveHook.error && steps.find((s) => s.id === "approve")?.status === "pending") {
      const friendly = friendlyTxError(approveHook.error).message;
      setStepStatus("approve", "failed", { error: friendly });
      setError(friendly);
    }
  }, [approveHook.isSuccess, approveHook.hash, approveHook.error]);

  // Proceed to commit step
  const proceedToCommit = useCallback(() => {
    if (hasStartedCommit.current) return;
    hasStartedCommit.current = true;

    const currentIntentId = useExecutionStore.getState().intentId;
    const currentQuote = useFormStore.getState().selectedQuote;
    const currentReceivingInfo = useFormStore.getState().receivingInfo;
    const currentRecipientName = useFormStore.getState().recipientName;

    if (!currentIntentId || !currentQuote?.solver?.address) {
      setError("Missing intent or quote data");
      return;
    }

    setStepStatus("commit", "pending");
    commitHook.commit(
      currentIntentId,
      currentQuote.solver.address as Address,
      currentQuote.rtpn,
      currentReceivingInfo,
      currentRecipientName
    );
  }, [commitHook, setStepStatus, setError]);

  // Step 3: Commit — watch for success
  useEffect(() => {
    if (commitHook.isSuccess && steps.find((s) => s.id === "commit")?.status === "pending") {
      setStepStatus("commit", "done", { txHash: commitHook.hash });
      setStepStatus("transferPending", "pending");
    }
    if (commitHook.error && steps.find((s) => s.id === "commit")?.status === "pending") {
      const friendly = friendlyTxError(commitHook.error).message;
      setStepStatus("commit", "failed", { error: friendly });
      setError(friendly);
    }
  }, [commitHook.isSuccess, commitHook.hash, commitHook.error]);

  // Step 4: Transfer Pending — poll for fulfillment
  const isTransferPending = steps.find((s) => s.id === "transferPending")?.status === "pending";

  const handleFulfilled = useCallback(() => {
    setStepStatus("transferPending", "done");
    setStepStatus("complete", "done");
  }, [setStepStatus]);

  usePollFulfillment(
    useExecutionStore.getState().intentId,
    isTransferPending,
    handleFulfilled
  );

  return {
    startExecution,
    view,
    steps,
    intentId,
  };
}
