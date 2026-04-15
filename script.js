const SUPABASE_URL = "https://awqwqpgrtbxvclszrgdb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_tM16nO4gpr-24M3I_1jgWA_0goMIFxt";

// Initialize the Supabase client properly
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let currentFiles = [];
let uploadTasks = new Map();
let searchTimeout = null;

// Utility functions
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showError(message, duration = 5000) {
    const msg = document.getElementById('auth-msg') || document.createElement('div');
    msg.textContent = message;
    msg.style.color = 'var(--error)';
    setTimeout(() => msg.textContent = '', duration);
}

function showSuccess(message, duration = 5000) {
    const msg = document.getElementById('auth-msg') || document.createElement('div');
    msg.textContent = message;
    msg.style.color = 'var(--success)';
    setTimeout(() => msg.textContent = '', duration);
}

// Auth Functions
async function handleAuth(isLogin = true) {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    if (!email || !password) {
        showError('Please enter both email and password');
        return;
    }

    try {
        if (isLogin) {
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });
            
            if (error) throw error;
            
            if (data.user) {
                showSuccess('Login successful!');
                setTimeout(() => {
                    window.location.href = 'files.html';
                }, 1000);
            }
        } else {
            const { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: {
                    emailRedirectTo: window.location.origin
                }
            });
            
            if (error) throw error;
            
            if (data.user?.identities?.length === 0) {
                showError('This email is already registered. Please log in instead.');
            } else {
                showSuccess('Account created! Login to continue.');
            }
        }
    } catch (error) {
        console.error('Auth error:', error);
        showError(error.message);
    }
}

async function checkAuth() {
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        
        if (error) throw error;
        
        if (!user) {
            if (!window.location.href.includes('index.html')) {
                window.location.href = 'index.html';
            }
            return false;
        }
        
        currentUser = user;
        return true;
    } catch (error) {
        console.error('Auth check error:', error);
        if (!window.location.href.includes('index.html')) {
            window.location.href = 'index.html';
        }
        return false;
    }
}

async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = 'index.html';
}

// File Management Functions
function getFileIcon(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    const icons = {
        pdf: 'file-pdf',
        doc: 'file-word', docx: 'file-word',
        xls: 'file-excel', xlsx: 'file-excel',
        ppt: 'file-powerpoint', pptx: 'file-powerpoint',
        jpg: 'file-image', jpeg: 'file-image', png: 'file-image', gif: 'file-image',
        mp3: 'file-audio', wav: 'file-audio',
        mp4: 'file-video', mov: 'file-video',
        zip: 'file-archive', rar: 'file-archive', '7z': 'file-archive',
        txt: 'file-alt',
        default: 'file'
    };
    return icons[ext] || icons.default;
}

function createFileCard(file) {
    const fileIcon = getFileIcon(file.name);
    return `
        <div class="file-card reveal" data-file-path="${file.name}">
            <div style="display: flex; flex-direction: column; height: 100%;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
                    <div style="width: 48px; height: 48px; min-width: 48px; background: rgba(99, 102, 241, 0.1); border-radius: 12px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(99, 102, 241, 0.2);">
                        <i class="fas fa-${fileIcon}" style="font-size: 1.25rem; color: var(--accent);"></i>
                    </div>
                    <div style="overflow: hidden;">
                        <div style="font-weight: 600; font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text);" title="${file.name}">${file.name}</div>
                        <div style="color: var(--muted); font-size: 0.75rem; margin-top: 2px;">${formatFileSize(file.metadata.size)} • ${formatDate(file.created_at).split(',')[0]}</div>
                    </div>
                </div>
                
                <div style="margin-top: auto; display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; gap: 4px;">
                        <button class="preview-btn secondary" style="padding: 8px; border-radius: 10px; font-size: 0.8rem;" title="Preview">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="download-btn secondary" style="padding: 8px; border-radius: 10px; font-size: 0.8rem;" title="Download">
                            <i class="fas fa-download"></i>
                        </button>
                    </div>
                    <button class="delete-btn secondary" style="padding: 8px; border-radius: 10px; color: var(--error); font-size: 0.8rem;" title="Delete">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        </div>
    `;
}

async function loadFiles(searchQuery = '', sortBy = 'name-asc') {
    if (!await checkAuth()) return;

    const filesList = document.getElementById('files-list');
    try {
        const { data, error } = await supabase.storage
            .from('user-files')
            .list(currentUser.id, {
                limit: 100,
                offset: 0,
                sortBy: { column: 'name', order: 'asc' }
            });

        if (error) throw error;

        if (!data || data.length === 0) {
            filesList.innerHTML = '<div class="reveal" style="text-align: center; color: var(--muted); grid-column: 1/-1; padding: 40px;"><i class="fas fa-folder-open fa-3x"></i><p style="margin-top: 16px;">No files found</p></div>';
            return;
        }

        currentFiles = data.filter(file => 
            file.name.toLowerCase().includes(searchQuery.toLowerCase())
        );

        const [sortField, sortOrder] = sortBy.split('-');
        currentFiles.sort((a, b) => {
            let comparison;
            switch (sortField) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'date':
                    comparison = new Date(a.created_at) - new Date(b.created_at);
                    break;
                case 'size':
                    comparison = a.metadata.size - b.metadata.size;
                    break;
                default:
                    comparison = 0;
            }
            return sortOrder === 'desc' ? -comparison : comparison;
        });

        filesList.innerHTML = currentFiles.length 
            ? currentFiles.map(createFileCard).join('')
            : '<div class="reveal" style="text-align: center; color: var(--muted); grid-column: 1/-1; padding: 60px 20px; border: 1px dashed var(--border); border-radius: 24px; background: rgba(255,255,255,0.01);"><i class="fas fa-folder-open fa-3x" style="opacity: 0.3; margin-bottom: 16px; display: block;"></i>No files found matching your search</div>';

        const fileCountEl = document.getElementById('file-count');
        if (fileCountEl) {
            fileCountEl.textContent = `${currentFiles.length} item${currentFiles.length !== 1 ? 's' : ''}`;
        }

        // Update storage stats
        const totalBytes = currentFiles.reduce((acc, file) => acc + (file.metadata.size || 0), 0);
        const totalUsageEl = document.getElementById('total-usage');
        if (totalUsageEl) {
            totalUsageEl.textContent = formatFileSize(totalBytes);
        }
        const usageBar = document.getElementById('usage-bar');
        if (usageBar) {
            // Assume 100MB free tier for visualization if unknown
            const percentage = Math.min((totalBytes / (100 * 1024 * 1024)) * 100, 100);
            usageBar.style.width = `${percentage || 5}%`;
        }

        // Add event listeners to new cards
        document.querySelectorAll('.preview-btn').forEach(btn => 
            btn.addEventListener('click', () => handlePreview(btn.closest('.file-card').dataset.filePath))
        );
        document.querySelectorAll('.download-btn').forEach(btn => 
            btn.addEventListener('click', () => handleDownload(btn.closest('.file-card').dataset.filePath))
        );
        document.querySelectorAll('.delete-btn').forEach(btn => 
            btn.addEventListener('click', () => handleDelete(btn.closest('.file-card').dataset.filePath))
        );
    } catch (error) {
        showError('Error loading files: ' + error.message);
    }
}

async function handlePreview(filePath) {
    try {
        const modal = document.getElementById('preview-modal');
        const filename = document.getElementById('preview-filename');
        const content = document.getElementById('preview-content');
        const downloadBtn = document.getElementById('preview-download');
        const deleteBtn = document.getElementById('preview-delete');

        filename.textContent = filePath;
        content.innerHTML = '<div style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin fa-2x"></i><p>Loading preview...</p></div>';
        modal.classList.add('active');

        const { data, error } = await supabase.storage
            .from('user-files')
            .download(`${currentUser.id}/${filePath}`);

        if (error) throw error;

        const ext = filePath.split('.').pop().toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            const url = URL.createObjectURL(data);
            content.innerHTML = `<img src="${url}" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);">`;
        } else if (['mp4', 'mov', 'webm'].includes(ext)) {
            const url = URL.createObjectURL(data);
            content.innerHTML = `<video controls style="max-width: 100%; border-radius: 8px;"><source src="${url}"></video>`;
        } else if (['mp3', 'wav'].includes(ext)) {
            const url = URL.createObjectURL(data);
            content.innerHTML = `<audio controls style="width: 100%;"><source src="${url}"></audio>`;
        } else if (['pdf'].includes(ext)) {
             const url = URL.createObjectURL(data);
             content.innerHTML = `<iframe src="${url}" style="width: 100%; height: 500px; border: none;"></iframe>`;
        } else {
            content.innerHTML = `<div style="padding: 40px; text-align: center; background: rgba(255,255,255,0.05); border-radius: 8px;">
                <i class="fas fa-${getFileIcon(filePath)} fa-4x" style="color: var(--accent); margin-bottom: 20px;"></i>
                <p>Preview not supported for this file type.</p>
                <p style="font-size: 0.875rem; color: var(--muted);">${filePath}</p>
            </div>`;
        }

        downloadBtn.onclick = () => handleDownload(filePath);
        deleteBtn.onclick = () => {
            modal.classList.remove('active');
            handleDelete(filePath);
        };
    } catch (error) {
        showError('Error previewing file: ' + error.message);
    }
}

async function handleDownload(filePath) {
    try {
        const { data, error } = await supabase.storage
            .from('user-files')
            .download(`${currentUser.id}/${filePath}`);

        if (error) throw error;

        const url = URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = filePath;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (error) {
        showError('Error downloading file: ' + error.message);
    }
}

async function handleDelete(filePath) {
    const modal = document.getElementById('delete-modal');
    const filename = document.getElementById('delete-filename');
    const confirmBtn = document.getElementById('confirm-delete');
    const cancelBtn = document.getElementById('cancel-delete');

    filename.textContent = filePath;
    modal.classList.add('active');

    confirmBtn.onclick = async () => {
        try {
            const fullPath = `${currentUser.id}/${filePath}`;
            const { error } = await supabase.storage
                .from('user-files')
                .remove([fullPath]);

            if (error) throw error;

            modal.classList.remove('active');
            showSuccess('File deleted successfully');
            await loadFiles(document.getElementById('search-input')?.value || '');
        } catch (error) {
            console.error('Delete error:', error);
            showError('Error deleting file: ' + error.message);
        }
    };

    cancelBtn.onclick = () => modal.classList.remove('active');
}

// Upload Functions
function createProgressElement(file) {
    return `
        <div class="file-progress" data-file-progress="${file.name}">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <i class="fas fa-${getFileIcon(file.name)}"></i>
                    <span style="font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${file.name}</span>
                </div>
                <span class="progress-percentage">0%</span>
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: 0%"></div>
            </div>
        </div>
    `;
}

function updateProgress(fileName, progress) {
    const element = document.querySelector(`[data-file-progress="${fileName}"]`);
    if (element) {
        element.querySelector('.progress-percentage').textContent = `${Math.round(progress)}%`;
        element.querySelector('.progress-fill').style.width = `${progress}%`;
    }
}

async function handleUpload(files) {
    if (!await checkAuth()) return;

    const progressSection = document.getElementById('upload-progress-section');
    const progressList = document.getElementById('upload-progress-list');
    
    progressSection.style.display = 'block';
    files = Array.from(files);

    // Create progress elements
    progressList.innerHTML = files.map(createProgressElement).join('');

    // Upload each file
    const uploads = files.map(async file => {
        try {
            updateProgress(file.name, 10); // Start progress
            
            const { data, error } = await supabase.storage
                .from('user-files')
                .upload(`${currentUser.id}/${file.name}`, file, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (error) throw error;
            
            updateProgress(file.name, 100);
            
            const progressElement = document.querySelector(`[data-file-progress="${file.name}"]`);
            if (progressElement) {
                progressElement.style.animation = 'fadeOut 0.5s ease forwards';
                setTimeout(() => {
                    progressElement.remove();
                    if (progressList.children.length === 0) {
                        progressSection.style.display = 'none';
                    }
                }, 500);
            }

        } catch (error) {
            console.error('Upload error:', error);
            showError(`Error uploading ${file.name}: ${error.message}`);
            const progressElement = document.querySelector(`[data-file-progress="${file.name}"]`);
            if (progressElement) {
                progressElement.style.color = 'var(--error)';
            }
        }
    });

    await Promise.all(uploads);
    await loadFiles(document.getElementById('search-input')?.value || '');
}

// Event Listeners
document.addEventListener('DOMContentLoaded', async () => {
    // Check if we are on index.html (auth page)
    const authForm = document.getElementById('auth-section');
    if (authForm) {
        const authLoginBtn = document.getElementById('login-btn');
        const authSignupBtn = document.getElementById('signup-btn');
        
        authLoginBtn.addEventListener('click', () => handleAuth(true));
        authSignupBtn.addEventListener('click', () => handleAuth(false));

        // Add enter key handler
        document.getElementById('password')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleAuth(true);
        });
        
        // If already logged in, redirect to files.html
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            window.location.href = 'files.html';
        }
        return;
    }

    // Files page initialization
    if (!await checkAuth()) return;

    // Search functionality
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadFiles(e.target.value, document.getElementById('sort-select').value);
        }, 300);
    });

    // Sort functionality
    document.getElementById('sort-select')?.addEventListener('change', (e) => {
        loadFiles(document.getElementById('search-input').value, e.target.value);
    });

    // Upload area
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const browseBtn = document.getElementById('browse-btn');
    
    if (uploadArea && fileInput && browseBtn) {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                handleUpload(e.dataTransfer.files);
            }
        });

        browseBtn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleUpload(fileInput.files);
            }
        });
    }

    // Modal close buttons
    document.getElementById('close-preview')?.addEventListener('click', () => {
        document.getElementById('preview-modal').classList.remove('active');
    });

    window.addEventListener('click', (e) => {
        const previewModal = document.getElementById('preview-modal');
        const deleteModal = document.getElementById('delete-modal');
        if (e.target === previewModal) previewModal.classList.remove('active');
        if (e.target === deleteModal) deleteModal.classList.remove('active');
    });

    // Minimize upload section
    document.getElementById('minimize-upload')?.addEventListener('click', () => {
        document.getElementById('upload-progress-section').style.display = 'none';
    });

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', handleLogout);

    // Initial load
    loadFiles();
});
