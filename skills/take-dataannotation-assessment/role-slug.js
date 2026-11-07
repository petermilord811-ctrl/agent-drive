// Shared role → filename slug helpers for the problems bank
function slugifyRole(role) {
  return String(role || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listRoles(catalog) {
  const out = [];
  for (const a of catalog.assessments || []) {
    for (const role of a.roles || []) {
      out.push({
        role,
        slug: slugifyRole(role),
        assessmentId: a.id,
        assessment: a.name,
        category: a.category,
      });
    }
  }
  return out;
}

module.exports = { slugifyRole, listRoles };
