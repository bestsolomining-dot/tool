import MiningRigNiceHash from './MiningRigNiceHash';
import MiningRigMRR from './MiningRigMRR';

export default function MiningRig({ onCall, output }) {
  return (
    <div className="mining-rig-container">
      <MiningRigNiceHash onCall={onCall} output={output} />
      <MiningRigMRR onCall={onCall} />
    </div>
  );
}
