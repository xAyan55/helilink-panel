const usernameInput = document.getElementById('userUsername');
const discordIdInput = document.getElementById('userDiscordId');
const createBtn = document.getElementById('createuserBtn');

function setCrit(id, passing) {
  const el = document.getElementById(id);
  const icon = el.querySelector('.crit-icon');
  if (passing) {
    el.classList.remove('text-neutral-400', 'text-red-500');
    el.classList.add('text-green-500');
    icon.textContent = '✓';
  } else {
    el.classList.remove('text-neutral-400', 'text-green-500');
    el.classList.add('text-red-500');
    icon.textContent = '✗';
  }
}

function resetCrit(id) {
  const el = document.getElementById(id);
  const icon = el.querySelector('.crit-icon');
  el.classList.remove('text-green-500', 'text-red-500');
  el.classList.add('text-neutral-400');
  icon.textContent = '—';
}

function checkUsername() {
  const val = usernameInput.value;
  if (!val) {
    resetCrit('crit-username-length');
    resetCrit('crit-username-chars');
    return false;
  }
  const lengthOk = val.length >= 3 && val.length <= 20;
  const charsOk = /^[a-zA-Z0-9]+$/.test(val);
  setCrit('crit-username-length', lengthOk);
  setCrit('crit-username-chars', charsOk);
  return lengthOk && charsOk;
}

function checkDiscordId() {
  const val = discordIdInput.value;
  if (!val) {
    resetCrit('crit-discordid-numeric');
    return false;
  }
  const numericOk = /^\d+$/.test(val.trim());
  setCrit('crit-discordid-numeric', numericOk);
  return numericOk;
}

usernameInput.addEventListener('input', checkUsername);
discordIdInput.addEventListener('input', checkDiscordId);

createBtn.addEventListener('click', async () => {
  const discordIdVal = discordIdInput.value.trim();
  const usernameVal = usernameInput.value.trim();
  const isAdmin = document.getElementById('userIsAdminSwitch').checked;

  if (!discordIdVal || !usernameVal) {
    showToast('Please fill in all required fields.', 'error');
    return;
  }
  if (!checkUsername()) {
    showToast('Username must be 3–20 characters, letters and numbers only.', 'error');
    return;
  }
  if (!checkDiscordId()) {
    showToast('Discord ID must be a numeric string.', 'error');
    return;
  }

  const loader = showLoadingPopup('Creating User', 'Processing user creation...');
  loader.updateProgress(20, 'Sending user information...');

  try {
    const response = await fetch('/admin/users/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordId: discordIdVal, username: usernameVal, isAdmin }),
    });

    if (response.ok) {
      loader.updateProgress(100, 'User created successfully!');
      setTimeout(() => {
        loader.close();
        showToast('User added. Welcome to the team.', 'success');
        setTimeout(() => { window.location.href = '/admin/users?err=none'; }, 1000);
      }, 500);
    } else {
      const err = await response.json().catch(() => ({ message: 'Failed to create user.' }));
      loader.close();
      showToast(err.message || 'Failed to create user.', 'error');
    }
  } catch (error) {
    loader.close();
    showToast('Failed to create user: ' + error.message, 'error');
  }
});
