// Region links work as document anchors without script; enhance them to filter in place.
document.querySelectorAll('[data-region-choice]').forEach(link => {
  link.addEventListener('click', event => {
    event.preventDefault();
    const selected = link.getAttribute('data-region-choice');
    const groups = [...document.querySelectorAll('[data-region-section]')];
    for (const group of groups) group.hidden = selected !== 'all' && group.getAttribute('data-region-section') !== selected;
    document.querySelectorAll('[data-region-choice]').forEach(choice => {
      if (choice.getAttribute('data-region-choice') === selected) choice.setAttribute('aria-current', 'true');
      else choice.removeAttribute('aria-current');
    });
    const visible = groups.filter(group => !group.hidden);
    const count = visible.reduce((sum, group) => sum + group.querySelectorAll('.component').length, 0);
    const output = document.querySelector('[data-region-count]');
    if (output) output.textContent = count + ' component' + (count === 1 ? '' : 's') + (selected === 'all' ? ' across all regions' : ' in ' + visible[0]?.getAttribute('aria-label'));
  });
});
