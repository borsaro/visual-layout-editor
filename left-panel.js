/** Single-open-section behavior for the left sidebar. */

document.querySelectorAll('.leftSectionTitle').forEach(title => {
  title.addEventListener('click', () => {
    document.querySelectorAll('.leftSection').forEach(section => {
      const open = section === title.parentElement;
      section.classList.toggle('isOpen', open);
      section.querySelector('.leftSectionTitle')?.setAttribute('aria-expanded', String(open));
    });
  });
});
