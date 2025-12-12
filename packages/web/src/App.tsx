import { useCallback } from "react";
import MapComponent from "./components/MapComponent";
import CanvasLayer from "./components/CanvasLayer";
import ReloadPrompt from "./ReloadPrompt";
import Debugger from "./components/Debugger";
import { useCanariaEngine } from "./hooks/useCanariaEngine";
import "./App.css";

function App() {
  const { points, connectionSource } = useCanariaEngine();

  const handlePointClick = useCallback((point: any) => {
    const props = point.properties;
    if (props.cluster) {
      console.log(`Cluster clicked: ${props.point_count} points`);
      alert(`Cluster: ${props.point_count} points`);
    } else {
      console.log(`Point clicked: ${props.id} (${props.type})`);
      alert(`Point: ${props.id}\nType: ${props.type}`);
    }
  }, []);

  return (
    <>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <MapComponent>
          <CanvasLayer points={points} onPointClick={handlePointClick} />
        </MapComponent>

        <Debugger pointCount={points.length} connectionSource={connectionSource} />
      </div>
      <ReloadPrompt />
    </>
  );
}

export default App;
