import { useCallback, useMemo } from "react"; // Import useMemo
import RGL, { WidthProvider, Layout } from "react-grid-layout";
import useWsConnection from "./WsConnection";
import TerminalComponent from "./TerminalComponent";

// Import RGL styles
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const ReactGridLayout = WidthProvider(RGL);

export function Terminals() {
  // Select the terminals object directly
  const terminals = useWsConnection((state) => state.terminals);
  // Select the update function directly (it's stable)
  const updateTerminalLayout = useWsConnection(
    (state) => state.updateTerminalLayout
  );

  // Memoize the layout definition
  const layout = useMemo(() => {
    console.log("Recalculating layout memo"); // Add log to see when this runs
    return Object.values(terminals).map((term) => ({
      i: term.id,
      x: term.x,
      y: term.y,
      w: term.w,
      h: term.h,
      // Add min/max constraints if desired
      minW: 2, // Example minimum width (in grid units)
      minH: 2, // Example minimum height (in grid units)
    }));
  }, [terminals]); // Recalculate only when the terminals object reference changes

  const handleLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      console.log("Layout change triggered", newLayout); // Log the raw event
      // Update the layout in the Zustand store for each changed item
      // This callback should *NOT* depend on `terminals` state directly
      // as that creates the potential for loops.
      newLayout.forEach((item) => {
        // We can get the *current* state from the store if needed,
        // but ideally, we just dispatch the update based on the event.
        // Let's directly call updateTerminalLayout which handles the merge.
        updateTerminalLayout(item.i, {
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        });
      });
    },
    [updateTerminalLayout] // Depend only on the stable update function
  );

  return (
    <ReactGridLayout
      layout={layout}
      onLayoutChange={handleLayoutChange}
      cols={12} // Number of columns in the grid
      rowHeight={30} // Height of a row in pixels
      isDraggable // Enable dragging
      isResizable // Enable resizing
      compactType={null} // Allow overlap
      preventCollision={false} // Allow overlap
      margin={[10, 10]} // Margin between items [x, y]
      containerPadding={[10, 10]} // Padding inside the layout container [x, y]
      useCSSTransforms={true} // Use CSS transforms for better performance
      // measureBeforeMount={false} // Might help with initial render issues if they occur
      style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0}} // Ensure it fills parent
    >
      {/* Use the memoized layout to generate children to potentially stabilize keys/order */} 
      {layout.map((item) => (
        <div key={item.i} className="terminal-instance-container">
          <TerminalComponent id={item.i} />
        </div>
      ))}
    </ReactGridLayout>
  );
}
