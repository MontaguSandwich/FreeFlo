import { useEffect, useCallback, useRef } from "react";
import { useAccount } from "wagmi";
import { type Address } from "viem";
import { useFormStore } from "@/stores/formStore";
import { useExecutionStore } from "@/stores/executionStore";
import { useCreateIntent } from "./useCreateIntent";
import { useApproveUSDC } from "./useApproveUSDC";
import { useCommitQuote } from "./useCommitQuote";
import { usePollFulfillment } from "./usePollFulfillment";
import { fetchOnChainQuotes, type RTPNQuote } from "@/lib/quotes";

export function useExecuteOfframp() {
  const { address } = useAccount();
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

      // Start polling for on-chain quotes
      if (!hasStartedQuotePoll.current) {
        hasStartedQuotePoll.current = true;
        const usdcAmount = parseFloat(amount);
        let pollCount = 0;

        const pollForQuotes = async () => {
          try {
            const realQuotes = await fetchOnChainQuotes(createIntentHook.intentId!, usdcAmount);
            if (realQuotes.length > 0) {
              // Found quotes — proceed to approve
              const matchingQuote = selectedQuote
                ? realQuotes.find((q) => q.rtpn === selectedQuote.rtpn) || realQuotes[0]
                : realQuotes[0];

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
      setStepStatus("createIntent", "failed", { error: createIntentHook.error.message });
      setError(createIntentHook.error.message);
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
      setStepStatus("approve", "failed", { error: approveHook.error.message });
      setError(approveHook.error.message);
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
      setStepStatus("commit", "failed", { error: commitHook.error.message });
      setError(commitHook.error.message);
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
