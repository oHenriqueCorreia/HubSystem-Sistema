import { closestCorners, defaultDropAnimationSideEffects, pointerWithin, type CollisionDetection, type DropAnimation } from "@dnd-kit/core";

/** Tempo com que os cartões abrem espaço e assentam nos quadros. */
export const DRAG_MOVE = { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" };
export const DROP_ANIMATION: DropAnimation = { ...DRAG_MOVE, sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.3" } } }) };

/**
 * Vale onde o dedo ou o mouse está. Só o tamanho do cartão não decide: com uma lista vazia ao lado,
 * ele cairia na lista seguinte (uma tarefa poderia ser concluída sem querer).
 * Fora de qualquer lista, como no teclado, segue o mais próximo.
 */
export const pointerFirst: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  if (!within.length) return closestCorners(args);
  const ids = new Set(within.map((c) => c.id));
  return closestCorners({ ...args, droppableContainers: args.droppableContainers.filter((c) => ids.has(c.id)) });
};
