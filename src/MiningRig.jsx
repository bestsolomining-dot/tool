import NiceHash from './components/NiceHash';
import MiningRigRental from './components/MiningRigRental';

export default function MiningRig({ onCall, output }) {
  return (
    <div className="mining-rig-container">
      <NiceHash onCall={onCall} output={output} />
      <MiningRigRental onCall={onCall} />
    </div>
  );
}
