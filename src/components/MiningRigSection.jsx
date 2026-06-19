import { useState, useCallback } from "react";
import MiningRigRental from "./MiningRigRental";
import MrrPoolsManager from "./MrrManager";

/**
 * Encapsulates the MiningRigRental component and its related state/props.
 */
export default function MiningRigSection({ onCall, rigsData }) {
  const [mrrClient, setMrrClient] = useState("VN");
  const [mrrPoolData, setMrrPoolData] = useState(null);
  const [mrrPoolRigId, setMrrPoolRigId] = useState("");
  const [mrrPoolRentalId, setMrrPoolRentalId] = useState("");

  const handleOpenMrrPools = useCallback(
    async (rig) => {
      if (!rig || !mrrClient) return;
      const targetClient =
        mrrClient === "VN" && rig.mrrClient ? rig.mrrClient : mrrClient;
      if (targetClient === "VN") return;

      const rigObj = typeof rig === "object" ? rig : { id: rig };
      const statusStr = String(
        typeof rigObj.status === "object"
          ? rigObj.status.status
          : rigObj.status || "",
      ).toLowerCase();
      const isRented = statusStr.includes("rented");
      const rigId = String(
        rigObj.rigid ||
          rigObj.rig_id ||
          rigObj.rig?.id ||
          (isRented ? "" : rigObj.id),
      ).trim();
      const rentalId = String(
        rigObj.rentalid ||
          rigObj.current_rental_id ||
          rigObj.rental_id ||
          (isRented ? rigObj.id : ""),
      ).trim();

      if (!rigId) return;

      const path = `/api/v2/mrr/rig/${encodeURIComponent(rigId)}/pool`;
      const result = await onCall(path, {
        query: { client: targetClient },
        silent: true,
      });

      if (result && result.success && result.data && rigObj.name) {
        const items = Array.isArray(result.data) ? result.data : [result.data];
        items.forEach((item) => {
          if (item && !item.name) item.name = rigObj.name;
        });
      }

      setMrrPoolData(result);
      setMrrPoolRigId(rigId);
      setMrrPoolRentalId(isRented ? rentalId : "");
    },
    [onCall, mrrClient],
  );

  return (
    <>
      <MiningRigRental
        onCall={onCall}
        mrrClient={mrrClient}
        setMrrClient={setMrrClient}
        onOpenMrrPools={handleOpenMrrPools}
      />
      {(mrrPoolData || mrrPoolRigId) && (
        <MrrPoolsManager
          onCall={onCall}
          mrrClient={mrrClient}
          externalPoolData={mrrPoolData}
          externalRigId={mrrPoolRigId}
          externalRentalId={mrrPoolRentalId}
          onClose={() => {
            setMrrPoolData(null);
            setMrrPoolRigId("");
            setMrrPoolRentalId("");
          }}
        />
      )}
    </>
  );
}
