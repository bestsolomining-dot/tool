import MiningRigRental from './MiningRigRental';

/**
 * Encapsulates the MiningRigRental component and its related state/props.
 */
export default function MiningRigSection({ onCall, mrrClient, setMrrClient }) {
  return (
    <MiningRigRental
      onCall={onCall}
      mrrClient={mrrClient}
      setMrrClient={setMrrClient}
    />
  );
}