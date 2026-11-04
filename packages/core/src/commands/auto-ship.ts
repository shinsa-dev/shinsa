export type AutoShipSystemCommand = {
  type: 'auto_ship.fire';
  taskId: string;
  gateId: string;
  dueAt: number;
};
