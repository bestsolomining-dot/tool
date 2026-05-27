import NiceHash from './NiceHash';
import MiningRigRental from './MiningRigRental';

export default function MiningRig({ onCall, output }) {
  return (
    <div className="mining-rig-container">
      <NiceHash onCall={onCall} output={output} />
      <MiningRigRental onCall={onCall} />
    </div>
  );
}
