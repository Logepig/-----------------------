(() => {
  const projectNavToggle = document.getElementById('project-nav-toggle');
  const projectNavMobile = document.getElementById('project-nav-mobile');

  if (!projectNavToggle || !projectNavMobile) return;

  // Toggle mobile project navigation
  projectNavToggle.addEventListener('click', () => {
    projectNavToggle.classList.toggle('active');
    projectNavMobile.classList.toggle('active');
  });

  // Close menu when clicking on a link
  const navLinks = projectNavMobile.querySelectorAll('.project-nav-link');
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      projectNavToggle.classList.remove('active');
      projectNavMobile.classList.remove('active');
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', (e) => {
    if (projectNavMobile.classList.contains('active') &&
        !projectNavMobile.contains(e.target) &&
        !projectNavToggle.contains(e.target)) {
      projectNavToggle.classList.remove('active');
      projectNavMobile.classList.remove('active');
    }
  });

  // Highlight active page
  const currentPage = window.location.pathname;
  navLinks.forEach(link => {
    if (link.getAttribute('href') === currentPage) {
      link.classList.add('active');
    }
  });
})();

