export default definePermissionEventHandler('admin', 'any', async () => {
  const groups = await Database.trafficGroups.getAll();
  return groups;
});
