import { useCallback, useReducer } from 'react';

// Generic undo/redo history hook (past / present / future pattern),
// implemented as a pure reducer.
//
// IMPORTANT: earlier versions of this hook stored `past`/`future` in
// plain refs and mutated them (push/pop/shift) from inside a setState
// updater function. That's an impure updater, and React 18's
// StrictMode intentionally invokes updaters twice in development to
// surface exactly this kind of bug -- which corrupted the stacks and
// made `redo()` throw once it reached a `future` slot that had already
// been shifted away by the duplicate invocation. Using useReducer with
// pure, immutable transitions avoids that: even if a reducer call runs
// twice, both runs produce the same result and only one is committed.
//
// - set(updater, { commit }) updates the current value.
//     commit: true  (default) -> the OLD present is pushed onto the
//             undo stack, so this change becomes its own undo step.
//     commit: false -> replaces the present in place without pushing a
//             new undo step. Used for continuous interactions (dragging
//             a wall, typing into a number field) so hundreds of
//             intermediate updates collapse into a single undo step.
// - beginInteraction() pushes a checkpoint of the CURRENT present onto
//   the undo stack without changing it. Call this once, right before a
//   continuous interaction starts (e.g. the first mousemove of a
//   drag), then use commit:false for the updates that follow. One
//   undo() afterwards returns to the pre-interaction state.
// - reset(value) replaces the present and clears all history (used
//   when loading a project from the server).

function historyReducer(state, action) {
  switch (action.type) {
    case 'SET': {
      const nextPresent =
        typeof action.updater === 'function' ? action.updater(state.present) : action.updater;
      if (action.commit === false) {
        return { ...state, present: nextPresent };
      }
      let past = [...state.past, state.present];
      if (past.length > action.maxEntries) past = past.slice(past.length - action.maxEntries);
      return { past, present: nextPresent, future: [] };
    }
    case 'BEGIN': {
      let past = [...state.past, state.present];
      if (past.length > action.maxEntries) past = past.slice(past.length - action.maxEntries);
      return { past, present: state.present, future: [] };
    }
    case 'UNDO': {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const past = state.past.slice(0, -1);
      const future = [state.present, ...state.future];
      return { past, present: previous, future };
    }
    case 'REDO': {
      if (state.future.length === 0) return state;
      const [next, ...restFuture] = state.future;
      const past = [...state.past, state.present];
      return { past, present: next, future: restFuture };
    }
    case 'RESET': {
      return { past: [], present: action.value, future: [] };
    }
    default:
      return state;
  }
}

export default function useHistory(initialPresent, maxEntries = 100) {
  const [state, dispatch] = useReducer(historyReducer, {
    past: [],
    present: initialPresent,
    future: [],
  });

  const set = useCallback(
    (updater, opts = {}) => {
      dispatch({ type: 'SET', updater, commit: opts.commit, maxEntries });
    },
    [maxEntries]
  );

  const beginInteraction = useCallback(() => {
    dispatch({ type: 'BEGIN', maxEntries });
  }, [maxEntries]);

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const reset = useCallback((value) => dispatch({ type: 'RESET', value }), []);

  return {
    value: state.present,
    set,
    beginInteraction,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
